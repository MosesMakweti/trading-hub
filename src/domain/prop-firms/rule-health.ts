/**
 * Live rule-health evaluation (spec §7). Each configured StageRule maps to at
 * most one evaluator below; a RuleKey with no registered evaluator dispatches
 * to MANUAL_TRACKING — never a fabricated pass/fail. Every evaluator returns
 * NOT_ENOUGH_DATA rather than guessing when its required inputs (a numeric
 * limit, executions, ledger history, equity data) aren't present.
 *
 * Two different "shapes" of rule exist here, and they use the four
 * limit-states (Safe/Approaching/Critical/Breached) differently:
 *   - LIMIT rules (loss/drawdown/risk/size ceilings): higher % of the limit
 *     consumed = more danger; 100%+ = Breached.
 *   - TARGET rules (profit target, min trading days, payout waiting period):
 *     higher % = closer to a GOOD outcome; 100%+ = TARGET_REACHED, not Breached.
 */
import { Decimal } from "decimal.js";

import type { RuleKeyLike } from "@/domain/prop-firms/rule-templates";
import { groupByTradingDay, tradingDayKeyFor } from "@/domain/prop-firms/session-boundary";

export type RuleValueTypeLike = "NUMERIC" | "MONETARY" | "PERCENTAGE" | "BOOLEAN" | "TEXT";
export type StageStatusLike = "PENDING" | "ACTIVE" | "PASSED" | "FAILED" | "BREACHED" | "RESET" | "ABANDONED" | "ARCHIVED";
export type LedgerEventTypeLike =
  | "ACCOUNT_INITIALIZED"
  | "TRADE_PNL"
  | "MANUAL_ADJUSTMENT"
  | "COMMISSION_FEE"
  | "CHALLENGE_PURCHASE_FEE"
  | "RESET_FEE"
  | "ACTIVATION_FEE"
  | "PAYOUT"
  | "REFUND"
  | "STAGE_PASSED"
  | "STAGE_FAILED"
  | "ACCOUNT_BREACHED"
  | "STAGE_STARTING_BALANCE_RESET"
  | "CUSTOM_ADJUSTMENT";
export type ExecutionStatusLike = "PLANNED" | "ALLOCATED" | "EXECUTED" | "PARTIALLY_CLOSED" | "CLOSED" | "CANCELLED" | "MISSED" | "NOT_TAKEN";

export type RuleState =
  | "SAFE"
  | "APPROACHING"
  | "CRITICAL"
  | "BREACHED"
  | "TARGET_REACHED"
  | "AWAITING_CONFIRMATION"
  | "NOT_ENOUGH_DATA"
  | "MANUAL_TRACKING";

export interface RuleHealthLedgerEntry {
  amount: Decimal.Value;
  balanceAfter: Decimal.Value;
  eventType: LedgerEventTypeLike;
  occurredAt: Date;
}

export interface RuleHealthExecution {
  netPnl: Decimal.Value | null;
  riskPercentOfBase: number | null;
  actualLotSize: Decimal.Value | null;
  actualContractQty: Decimal.Value | null;
  status: ExecutionStatusLike;
  closedAt: Date | null;
  plannedAt: Date;
}

export interface RuleHealthRule {
  id: string;
  ruleKey: RuleKeyLike;
  valueType: RuleValueTypeLike;
  numericValue: Decimal.Value | null;
  measurementBasis: string | null;
  warningThreshold: Decimal.Value | null;
  criticalThreshold: Decimal.Value | null;
  breachThreshold: Decimal.Value | null;
}

export interface RuleEvaluationContext {
  rule: RuleHealthRule;
  account: { dailyResetTimezone: string | null; dailyResetHour: number };
  stage: { startingBalance: Decimal.Value; startDate: Date | null; status: StageStatusLike };
  /** This stage's ledger entries only (caller filters by stageId), chronological order not required. */
  ledgerEntries: RuleHealthLedgerEntry[];
  /** This stage's executions only, chronological order not required. */
  executions: RuleHealthExecution[];
  /** Ledger-derived current balance (see account-ledger.service.ts). */
  currentBalance: Decimal.Value;
  now: Date;
  /** Only read by PROFIT_TARGET: null when no MIN_TRADING_DAYS rule is
   *  configured on this stage (met by default); otherwise that rule's own
   *  evaluated outcome. */
  minTradingDaysMet?: boolean | null;
}

export interface RuleEvaluationResult {
  ruleId: string;
  state: RuleState;
  percentConsumed: number | null;
  currentValue: Decimal | null;
  limitValue: Decimal | null;
  detail: string;
}

function notEnoughData(ruleId: string, detail: string): RuleEvaluationResult {
  return { ruleId, state: "NOT_ENOUGH_DATA", percentConsumed: null, currentValue: null, limitValue: null, detail };
}

function manualTracking(ruleId: string, detail: string): RuleEvaluationResult {
  return { ruleId, state: "MANUAL_TRACKING", percentConsumed: null, currentValue: null, limitValue: null, detail };
}

export interface Thresholds {
  warningThreshold: Decimal.Value | null;
  criticalThreshold: Decimal.Value | null;
  breachThreshold: Decimal.Value | null;
}

const DEFAULT_WARNING_PERCENT = 70;
const DEFAULT_CRITICAL_PERCENT = 90;
const DEFAULT_BREACH_PERCENT = 100;

/** Limit-rule state from % of the limit consumed — clamped floor at 0%. */
export function stateFromPercent(percentConsumed: Decimal, thresholds: Thresholds): "SAFE" | "APPROACHING" | "CRITICAL" | "BREACHED" {
  const p = Decimal.max(0, percentConsumed);
  const warning = new Decimal(thresholds.warningThreshold ?? DEFAULT_WARNING_PERCENT);
  const critical = new Decimal(thresholds.criticalThreshold ?? DEFAULT_CRITICAL_PERCENT);
  const breach = new Decimal(thresholds.breachThreshold ?? DEFAULT_BREACH_PERCENT);
  if (p.greaterThanOrEqualTo(breach)) return "BREACHED";
  if (p.greaterThanOrEqualTo(critical)) return "CRITICAL";
  if (p.greaterThanOrEqualTo(warning)) return "APPROACHING";
  return "SAFE";
}

function resolveLimit(rule: RuleHealthRule, base: Decimal): Decimal | null {
  if (rule.numericValue == null) return null;
  const value = new Decimal(rule.numericValue);
  if (rule.valueType === "PERCENTAGE") return base.times(value).dividedBy(100);
  if (rule.valueType === "MONETARY" || rule.valueType === "NUMERIC") return value;
  return null;
}

function isEquityBasis(rule: RuleHealthRule): boolean {
  return (rule.measurementBasis ?? "").toLowerCase().includes("equity");
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

// ── LIMIT rules ────────────────────────────────────────────────────────────

function evaluateMaxDailyLoss(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No daily loss limit configured on this stage.");
  if (isEquityBasis(ctx.rule)) return notEnoughData(ctx.rule.id, "Equity-based daily loss needs live equity data, which isn't tracked yet.");

  const todayKey = tradingDayKeyFor(ctx.now, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour);
  const sortedEntries = [...ctx.ledgerEntries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const beforeToday = sortedEntries.filter(
    (e) => tradingDayKeyFor(e.occurredAt, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour) < todayKey,
  );
  // The basis is the balance AS OF the start of today (yesterday's EOD, or
  // the stage's starting balance on day one) — never today's own
  // mid-day-shrinking balance, which would create a feedback loop where
  // losing more today shrinks the limit itself.
  const startOfDayBalance =
    beforeToday.length > 0 ? new Decimal(beforeToday[beforeToday.length - 1].balanceAfter) : new Decimal(ctx.stage.startingBalance);
  const limit = resolveLimit(ctx.rule, startOfDayBalance);
  if (limit == null) return notEnoughData(ctx.rule.id, "This rule's value type isn't a daily-loss amount/percentage.");

  const buckets = groupByTradingDay(
    ctx.ledgerEntries.filter((e) => e.eventType === "TRADE_PNL"),
    (e) => e.occurredAt,
    ctx.account.dailyResetTimezone,
    ctx.account.dailyResetHour,
  );
  const todaysEntries = buckets.get(todayKey) ?? [];
  const todaysPnl = todaysEntries.reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
  const lossToday = Decimal.max(0, todaysPnl.negated());

  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(lossToday.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: lossToday.dividedBy(limit).times(100).toNumber(),
    currentValue: lossToday,
    limitValue: limit,
    detail: `Today's realized loss: ${lossToday.toFixed(2)} of ${limit.toFixed(2)} allowed.`,
  };
}

function evaluateMaxTotalLoss(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No max total loss configured on this stage.");
  if (isEquityBasis(ctx.rule)) return notEnoughData(ctx.rule.id, "Equity-based total loss needs live equity data, which isn't tracked yet.");

  const startingBalance = new Decimal(ctx.stage.startingBalance);
  const limit = resolveLimit(ctx.rule, startingBalance);
  if (limit == null) return notEnoughData(ctx.rule.id, "This rule's value type isn't a total-loss amount/percentage.");

  const totalLoss = Decimal.max(0, startingBalance.minus(ctx.currentBalance));
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(totalLoss.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: totalLoss.dividedBy(limit).times(100).toNumber(),
    currentValue: totalLoss,
    limitValue: limit,
    detail: `Cumulative loss from starting balance: ${totalLoss.toFixed(2)} of ${limit.toFixed(2)} allowed.`,
  };
}

function evaluateStaticDrawdown(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No static drawdown limit configured on this stage.");
  const startingBalance = new Decimal(ctx.stage.startingBalance);
  const drawdownAllowance = resolveLimit(ctx.rule, startingBalance);
  if (drawdownAllowance == null) return notEnoughData(ctx.rule.id, "This rule's value type isn't a drawdown amount/percentage.");

  const floor = startingBalance.minus(drawdownAllowance); // never moves — "static"
  const currentBalance = new Decimal(ctx.currentBalance);
  const consumed = Decimal.max(0, startingBalance.minus(currentBalance));
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(consumed.dividedBy(drawdownAllowance).times(100), ctx.rule),
    percentConsumed: consumed.dividedBy(drawdownAllowance).times(100).toNumber(),
    currentValue: currentBalance,
    limitValue: floor,
    detail: `Static floor: ${floor.toFixed(2)} (current balance ${currentBalance.toFixed(2)}).`,
  };
}

function evaluateIntradayTrailingDrawdown(ctx: RuleEvaluationContext): RuleEvaluationResult {
  return notEnoughData(
    ctx.rule.id,
    "Intraday trailing drawdown needs intraday equity snapshots, which this app doesn't capture yet — tracked manually for now.",
  );
}

function evaluateEodTrailingDrawdown(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No trailing drawdown limit configured on this stage.");
  if (ctx.ledgerEntries.length === 0) return notEnoughData(ctx.rule.id, "No ledger history yet for this stage.");

  const startingBalance = new Decimal(ctx.stage.startingBalance);
  const sorted = [...ctx.ledgerEntries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let peak = startingBalance;
  for (const entry of sorted) {
    const balance = new Decimal(entry.balanceAfter);
    if (balance.greaterThan(peak)) peak = balance;
  }

  const allowance = resolveLimit({ ...ctx.rule, numericValue: ctx.rule.numericValue }, peak);
  if (allowance == null) return notEnoughData(ctx.rule.id, "This rule's value type isn't a drawdown amount/percentage.");

  const floor = peak.minus(allowance);
  const currentBalance = new Decimal(ctx.currentBalance);
  const consumed = Decimal.max(0, peak.minus(currentBalance));
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(consumed.dividedBy(allowance).times(100), ctx.rule),
    percentConsumed: consumed.dividedBy(allowance).times(100).toNumber(),
    currentValue: currentBalance,
    limitValue: floor,
    detail: `Trailing from peak balance ${peak.toFixed(2)}; floor is ${floor.toFixed(2)}.`,
  };
}

function evaluateMaxTradingDays(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No trading-day deadline configured on this stage.");
  const limit = new Decimal(ctx.rule.numericValue);
  const closed = ctx.executions.filter((e) => e.status === "CLOSED" || e.status === "PARTIALLY_CLOSED");
  const daysUsed = groupByTradingDay(closed, (e) => e.closedAt ?? e.plannedAt, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour).size;
  const used = new Decimal(daysUsed);
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(used.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: used.dividedBy(limit).times(100).toNumber(),
    currentValue: used,
    limitValue: limit,
    detail: `${daysUsed} of ${limit.toFixed(0)} allotted trading days used.`,
  };
}

function evaluateConsistencyRule(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No consistency limit configured on this stage.");
  const tradePnlEntries = ctx.ledgerEntries.filter((e) => e.eventType === "TRADE_PNL");
  if (tradePnlEntries.length === 0) return notEnoughData(ctx.rule.id, "No realized trades yet to evaluate consistency against.");

  const byDay = groupByTradingDay(tradePnlEntries, (e) => e.occurredAt, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour);
  let totalProfit = new Decimal(0);
  let largestDayProfit = new Decimal(0);
  for (const entries of byDay.values()) {
    const dayPnl = entries.reduce((sum, e) => sum.plus(e.amount), new Decimal(0));
    if (dayPnl.greaterThan(0)) {
      totalProfit = totalProfit.plus(dayPnl);
      if (dayPnl.greaterThan(largestDayProfit)) largestDayProfit = dayPnl;
    }
  }
  if (!totalProfit.greaterThan(0)) return notEnoughData(ctx.rule.id, "No profitable days yet to evaluate consistency against.");

  const largestDayShare = largestDayProfit.dividedBy(totalProfit).times(100);
  const limit = new Decimal(ctx.rule.numericValue);
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(largestDayShare.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: largestDayShare.dividedBy(limit).times(100).toNumber(),
    currentValue: largestDayShare,
    limitValue: limit,
    detail: `Largest single day is ${largestDayShare.toFixed(1)}% of total profit (limit ${limit.toFixed(1)}%).`,
  };
}

function evaluateMaxRiskPerTrade(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No max risk per trade configured on this stage.");
  const withRisk = ctx.executions.filter((e) => e.riskPercentOfBase != null);
  if (withRisk.length === 0) return notEnoughData(ctx.rule.id, "No allocations with a resolvable risk % yet.");

  const highest = withRisk.reduce((max, e) => Math.max(max, e.riskPercentOfBase!), 0);
  const currentValue = new Decimal(highest);
  const limit = new Decimal(ctx.rule.numericValue);
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(currentValue.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: currentValue.dividedBy(limit).times(100).toNumber(),
    currentValue,
    limitValue: limit,
    detail: `Highest single-trade risk so far: ${currentValue.toFixed(2)}% (limit ${limit.toFixed(2)}%).`,
  };
}

function evaluateMaxRiskPerDay(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No max risk per day configured on this stage.");
  const withRisk = ctx.executions.filter((e) => e.riskPercentOfBase != null);
  if (withRisk.length === 0) return notEnoughData(ctx.rule.id, "No allocations with a resolvable risk % yet.");

  const byDay = groupByTradingDay(withRisk, (e) => e.plannedAt, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour);
  let peakDayRisk = 0;
  for (const dayExecutions of byDay.values()) {
    const combined = dayExecutions.reduce((sum, e) => sum + (e.riskPercentOfBase ?? 0), 0);
    if (combined > peakDayRisk) peakDayRisk = combined;
  }
  const currentValue = new Decimal(peakDayRisk);
  const limit = new Decimal(ctx.rule.numericValue);
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(currentValue.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: currentValue.dividedBy(limit).times(100).toNumber(),
    currentValue,
    limitValue: limit,
    detail: `Highest combined same-day risk so far: ${currentValue.toFixed(2)}% (limit ${limit.toFixed(2)}%).`,
  };
}

function evaluateMaxSize(field: "actualLotSize" | "actualContractQty") {
  return (ctx: RuleEvaluationContext): RuleEvaluationResult => {
    if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No max size configured on this stage.");
    const sizes = ctx.executions.map((e) => e[field]).filter((s): s is Decimal.Value => s != null);
    if (sizes.length === 0) return notEnoughData(ctx.rule.id, "No executions with a recorded size yet.");

    const highest = sizes.reduce<Decimal>((max, s) => Decimal.max(max, new Decimal(s)), new Decimal(0));
    const limit = new Decimal(ctx.rule.numericValue);
    return {
      ruleId: ctx.rule.id,
      state: stateFromPercent(highest.dividedBy(limit).times(100), ctx.rule),
      percentConsumed: highest.dividedBy(limit).times(100).toNumber(),
      currentValue: highest,
      limitValue: limit,
      detail: `Largest single-execution size so far: ${highest.toFixed(4)} (limit ${limit.toFixed(4)}).`,
    };
  };
}

// ── TARGET rules (higher % = closer to a good outcome) ─────────────────────

function evaluateProfitTarget(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No profit target configured on this stage.");
  const startingBalance = new Decimal(ctx.stage.startingBalance);
  const targetAmount = resolveLimit(ctx.rule, startingBalance);
  if (targetAmount == null || !targetAmount.greaterThan(0)) return notEnoughData(ctx.rule.id, "This rule's value type isn't a profit target amount/percentage.");

  const profitSoFar = new Decimal(ctx.currentBalance).minus(startingBalance);
  const percentConsumed = Decimal.max(0, profitSoFar).dividedBy(targetAmount).times(100);
  const reached = percentConsumed.greaterThanOrEqualTo(100);

  if (reached) {
    if (ctx.minTradingDaysMet === false) {
      return {
        ruleId: ctx.rule.id,
        state: "CRITICAL",
        percentConsumed: percentConsumed.toNumber(),
        currentValue: profitSoFar,
        limitValue: targetAmount,
        detail: "Profit target reached, but the minimum trading-days requirement isn't satisfied yet.",
      };
    }
    return {
      ruleId: ctx.rule.id,
      state: "TARGET_REACHED",
      percentConsumed: percentConsumed.toNumber(),
      currentValue: profitSoFar,
      limitValue: targetAmount,
      detail: `Profit target of ${targetAmount.toFixed(2)} reached.`,
    };
  }

  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(percentConsumed, ctx.rule),
    percentConsumed: percentConsumed.toNumber(),
    currentValue: profitSoFar,
    limitValue: targetAmount,
    detail: `${profitSoFar.toFixed(2)} of ${targetAmount.toFixed(2)} profit target reached.`,
  };
}

function evaluateMinTradingDays(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No minimum trading-days requirement configured on this stage.");
  const required = new Decimal(ctx.rule.numericValue);
  const closed = ctx.executions.filter((e) => e.status === "CLOSED" || e.status === "PARTIALLY_CLOSED");
  const completed = groupByTradingDay(closed, (e) => e.closedAt ?? e.plannedAt, ctx.account.dailyResetTimezone, ctx.account.dailyResetHour).size;
  const completedDecimal = new Decimal(completed);
  const percentConsumed = Decimal.min(100, completedDecimal.dividedBy(required).times(100));
  return {
    ruleId: ctx.rule.id,
    state: completed >= required.toNumber() ? "TARGET_REACHED" : "SAFE",
    percentConsumed: percentConsumed.toNumber(),
    currentValue: completedDecimal,
    limitValue: required,
    detail: `${completed} of ${required.toFixed(0)} required trading days completed.`,
  };
}

function evaluatePayoutWaitingPeriod(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No payout waiting period configured on this stage.");
  if (!ctx.stage.startDate) return notEnoughData(ctx.rule.id, "This stage has no start date yet to measure the waiting period from.");

  const requiredDays = new Decimal(ctx.rule.numericValue);
  const elapsedDays = new Decimal(daysBetween(ctx.now, ctx.stage.startDate));
  const percentConsumed = Decimal.min(100, elapsedDays.dividedBy(requiredDays).times(100));
  const eligible = elapsedDays.greaterThanOrEqualTo(requiredDays);
  return {
    ruleId: ctx.rule.id,
    state: eligible ? "TARGET_REACHED" : stateFromPercent(percentConsumed, ctx.rule),
    percentConsumed: percentConsumed.toNumber(),
    currentValue: elapsedDays,
    limitValue: requiredDays,
    detail: eligible
      ? "Payout waiting period satisfied."
      : `${elapsedDays.toFixed(1)} of ${requiredDays.toFixed(0)} waiting days elapsed.`,
  };
}

function evaluateInactivityLimit(ctx: RuleEvaluationContext): RuleEvaluationResult {
  if (ctx.rule.numericValue == null) return notEnoughData(ctx.rule.id, "No inactivity limit configured on this stage.");

  const lastLedgerAt = ctx.ledgerEntries.length > 0
    ? ctx.ledgerEntries.reduce((latest, e) => (e.occurredAt > latest ? e.occurredAt : latest), ctx.ledgerEntries[0].occurredAt)
    : null;
  const closedExecutions = ctx.executions.filter((e) => e.closedAt != null);
  const lastExecutionAt = closedExecutions.length > 0
    ? closedExecutions.reduce((latest, e) => (e.closedAt! > latest ? e.closedAt! : latest), closedExecutions[0].closedAt!)
    : null;
  const lastActivity =
    lastLedgerAt && lastExecutionAt ? (lastLedgerAt > lastExecutionAt ? lastLedgerAt : lastExecutionAt) : (lastLedgerAt ?? lastExecutionAt ?? ctx.stage.startDate);

  if (!lastActivity) return notEnoughData(ctx.rule.id, "No activity recorded yet on this stage.");

  const limit = new Decimal(ctx.rule.numericValue);
  const inactiveDays = new Decimal(daysBetween(ctx.now, lastActivity));
  return {
    ruleId: ctx.rule.id,
    state: stateFromPercent(inactiveDays.dividedBy(limit).times(100), ctx.rule),
    percentConsumed: inactiveDays.dividedBy(limit).times(100).toNumber(),
    currentValue: inactiveDays,
    limitValue: limit,
    detail: `${inactiveDays.toFixed(1)} days since last activity (limit ${limit.toFixed(0)}).`,
  };
}

function evaluateProfitSplit(ctx: RuleEvaluationContext): RuleEvaluationResult {
  return manualTracking(
    ctx.rule.id,
    ctx.rule.numericValue != null
      ? `Configured profit split: ${new Decimal(ctx.rule.numericValue).toFixed(1)}% — informational, applied at payout time.`
      : "No profit split configured.",
  );
}

export const RULE_EVALUATORS: Partial<Record<RuleKeyLike, (ctx: RuleEvaluationContext) => RuleEvaluationResult>> = {
  PROFIT_TARGET: evaluateProfitTarget,
  MAX_DAILY_LOSS: evaluateMaxDailyLoss,
  MAX_TOTAL_LOSS: evaluateMaxTotalLoss,
  STATIC_DRAWDOWN: evaluateStaticDrawdown,
  INTRADAY_TRAILING_DRAWDOWN: evaluateIntradayTrailingDrawdown,
  EOD_TRAILING_DRAWDOWN: evaluateEodTrailingDrawdown,
  MIN_TRADING_DAYS: evaluateMinTradingDays,
  MAX_TRADING_DAYS: evaluateMaxTradingDays,
  CONSISTENCY_RULE: evaluateConsistencyRule,
  MAX_RISK_PER_TRADE: evaluateMaxRiskPerTrade,
  MAX_RISK_PER_DAY: evaluateMaxRiskPerDay,
  MAX_LOT_SIZE: evaluateMaxSize("actualLotSize"),
  MAX_CONTRACT_SIZE: evaluateMaxSize("actualContractQty"),
  INACTIVITY_LIMIT: evaluateInactivityLimit,
  PAYOUT_WAITING_PERIOD: evaluatePayoutWaitingPeriod,
  PROFIT_SPLIT: evaluateProfitSplit,
  // DRAWDOWN_BALANCE_BASED/DRAWDOWN_EQUITY_BASED, MAX_OPEN_POSITIONS, every
  // *_RESTRICTION rule, SCALING_REQUIREMENT, and CUSTOM have no evaluator —
  // they dispatch to MANUAL_TRACKING below, never a fabricated evaluation.
};

/** Dispatches to the registered evaluator for this rule's key, or
 *  MANUAL_TRACKING when none exists. This is the one entry point callers
 *  (trades-tab.tsx's live rule badges, rules-tab.tsx, the pre-save warning
 *  check, the "Target reached" stage-completion banner) should use. */
export function evaluateRule(ctx: RuleEvaluationContext): RuleEvaluationResult {
  const evaluator = RULE_EVALUATORS[ctx.rule.ruleKey];
  if (!evaluator) return manualTracking(ctx.rule.id, "This rule type isn't automatically evaluated yet — track it manually.");
  return evaluator(ctx);
}
