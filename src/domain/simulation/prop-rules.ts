/**
 * Prop-firm rule engine — pure and deterministic (docs/SIMULATION_PLATFORM.md).
 *
 * Evaluates an account's frozen rule snapshot minute by minute, from the
 * step engine's snapshots (balance, close equity, adverse equity). Each
 * drawdown model is implemented as its own calculation:
 *
 *   STATIC              floor = start − L                       (never moves)
 *   EOD_TRAILING        floor = highest END-OF-DAY value − L    (moves only at the daily reset)
 *   INTRADAY_TRAILING   floor = highest value at any minute − L (moves continuously)
 *     L = limit% × phase starting balance; with `trailingLockAtStart` a trailing floor stops at `start`.
 *     value tracked = balance (BALANCE basis) or close equity (EQUITY basis).
 *     breach when the MEASURED value < floor: balance, or the minute's ADVERSE equity (worst price, D6).
 *
 *   Daily loss — floor for the current trading day (broker clock, reset hour):
 *     INITIAL_BALANCE     floor = day-start balance − limit% × phase start
 *     DAY_START_BALANCE   floor = day-start balance × (1 − limit%)
 *     DAY_START_HIGHER    floor = max(day-start balance, day-start equity) × (1 − limit%)
 *
 * Passing needs EVERY condition at once: balance ≥ target, no open
 * positions, minimum trading days, and consistency (best day ≤ X% of total
 * profit). Calendar-day limits fail a phase that hasn't passed in time.
 * Holding rules breach when a position is held across a daily reset
 * (overnight) or a weekend.
 *
 * Money is Decimal throughout; state is serialisable (decimal strings) so it
 * can be persisted between clock steps.
 */
import type { Decimal } from "decimal.js";

import { dec } from "@/domain/execution/precision";
import type { SimRules } from "./rules";

export type BreachRule = "DAILY_LOSS" | "MAX_LOSS" | "OVERNIGHT_HOLDING" | "WEEKEND_HOLDING";

export interface RuleState {
  version: 1;
  phaseStartBalance: string;
  /** Trading-day index (broker clock) the phase started in. */
  firstDay: number;
  /** Current trading day and the values it started with. */
  day: number;
  dayStartBalance: string;
  dayStartEquity: string;
  /** Last evaluated minute's values (become the next day's start values at a reset). */
  lastBalance: string;
  lastEquity: string;
  /** Highest tracked value for the trailing model (EOD: end-of-day values; intraday: any minute). */
  highWater: string;
  /** Trading days with at least one opened position. */
  tradingDays: number[];
  /** Realized profit per trading day (balance change), for consistency. */
  dayProfit: Record<string, string>;
}

export function initialRuleState(startBalance: Decimal.Value, startDay: number): RuleState {
  const s = dec(startBalance).toFixed(2);
  return { version: 1, phaseStartBalance: s, firstDay: startDay, day: startDay, dayStartBalance: s, dayStartEquity: s, lastBalance: s, lastEquity: s, highWater: s, tradingDays: [], dayProfit: {} };
}

export interface MinuteInput {
  minute: number;
  tradingDay: number;
  balance: Decimal;
  equity: Decimal;
  adverseEquity: Decimal;
  openPositions: number;
}

export interface Floors {
  dailyLossFloor: Decimal | null;
  maxLossFloor: Decimal | null;
  profitTarget: Decimal | null;
}

export type Verdict =
  | { kind: "CONTINUE" }
  | { kind: "BREACH"; rule: BreachRule; minute: number; measured: Decimal; floor: Decimal | null; basis: "BALANCE" | "EQUITY" | null; detail: string }
  | { kind: "PASS"; minute: number }
  | { kind: "FAIL"; minute: number; reason: string };

/** The current floors, from the state's values (pure). */
export function currentFloors(rules: SimRules, state: RuleState): Floors {
  const start = dec(state.phaseStartBalance);
  let dailyLossFloor: Decimal | null = null;
  if (rules.dailyLoss) {
    const pct = dec(rules.dailyLoss.limitPercent).dividedBy(100);
    const dsb = dec(state.dayStartBalance);
    const dse = dec(state.dayStartEquity);
    if (rules.dailyLoss.reference === "INITIAL_BALANCE") dailyLossFloor = dsb.minus(start.times(pct));
    else if (rules.dailyLoss.reference === "DAY_START_BALANCE") dailyLossFloor = dsb.times(dec(1).minus(pct));
    else dailyLossFloor = (dsb.greaterThan(dse) ? dsb : dse).times(dec(1).minus(pct));
  }
  let maxLossFloor: Decimal | null = null;
  if (rules.maxLoss) {
    const amount = start.times(rules.maxLoss.limitPercent).dividedBy(100);
    if (rules.maxLoss.model === "STATIC") {
      maxLossFloor = start.minus(amount);
    } else {
      const trailing = dec(state.highWater).minus(amount);
      maxLossFloor = rules.maxLoss.trailingLockAtStart && trailing.greaterThan(start) ? start : trailing;
    }
  }
  const t = rules.objective.profitTargetPercent;
  return { dailyLossFloor, maxLossFloor, profitTarget: t == null ? null : start.times(dec(1).plus(dec(t).dividedBy(100))) };
}

const WEEKDAY = (day: number, resetHour: number) => {
  // Weekday of the trading day's start minute (broker clock); minute 0 = Thursday.
  const startMinute = day * 1440 + resetHour * 60;
  return ((Math.floor(startMinute / 1440) + 4) % 7 + 7) % 7;
};

/** Did moving from trading day `from` to `to` cross a weekend (a Saturday)? */
export function crossesWeekend(from: number, to: number, resetHour: number): boolean {
  for (let d = from + 1; d <= to; d += 1) if (WEEKDAY(d, resetHour) === 6) return true;
  return to - from >= 7;
}

/** Best day's share of total profit, in % (null when there's no total profit). */
export function bestDayShare(state: RuleState): number | null {
  const profits = Object.values(state.dayProfit).map((v) => dec(v));
  const total = profits.reduce((s, v) => s.plus(v), dec(0));
  if (!total.greaterThan(0)) return null;
  const best = profits.reduce((m, v) => (v.greaterThan(m) ? v : m), dec(0));
  return best.dividedBy(total).times(100).toNumber();
}

export interface PassCheck {
  met: boolean;
  unmet: string[];
}

/** Every passing condition, evaluated together. */
export function passConditions(rules: SimRules, state: RuleState, at: { balance: Decimal; openPositions: number }): PassCheck {
  const unmet: string[] = [];
  const { profitTarget } = currentFloors(rules, state);
  if (profitTarget == null) return { met: false, unmet: ["No profit target on this phase."] };
  if (at.balance.lessThan(profitTarget)) unmet.push(`Balance below the ${profitTarget.toFixed(2)} target.`);
  if (at.openPositions > 0) unmet.push("Close every open position.");
  const minDays = rules.objective.minTradingDays ?? 0;
  if (state.tradingDays.length < minDays) unmet.push(`Trade on ${minDays} days (${state.tradingDays.length} so far).`);
  const cap = rules.objective.consistencyMaxDayPercent;
  if (cap != null) {
    const share = bestDayShare(state);
    if (share != null && share > cap) unmet.push(`Best day is ${share.toFixed(1)}% of profit; at most ${cap}% allowed.`);
  }
  return { met: unmet.length === 0, unmet };
}

/**
 * Advances the state by one evaluated minute and returns the verdict.
 * Mutates and returns `state` (callers persist it). `heldPositionsAtReset`
 * is the number of positions open across a daily reset at this minute.
 */
export function evaluateMinute(rules: SimRules, state: RuleState, m: MinuteInput, heldPositionsAtReset = 0): Verdict {
  // ── Daily reset ─────────────────────────────────────────────────────────
  if (m.tradingDay > state.day) {
    const prevDay = state.day;
    // End-of-day trailing high-water uses the value the previous day ended on.
    if (rules.maxLoss?.model === "EOD_TRAILING") {
      const eod = dec(rules.maxLoss.basis === "BALANCE" ? state.lastBalance : state.lastEquity);
      if (eod.greaterThan(state.highWater)) state.highWater = eod.toFixed(2);
    }
    state.day = m.tradingDay;
    state.dayStartBalance = state.lastBalance;
    state.dayStartEquity = state.lastEquity;
    if (heldPositionsAtReset > 0) {
      if (!rules.holding.allowWeekend && crossesWeekend(prevDay, m.tradingDay, rules.dailyResetHour)) {
        return { kind: "BREACH", rule: "WEEKEND_HOLDING", minute: m.minute, measured: m.equity, floor: null, basis: null, detail: `${heldPositionsAtReset} position(s) held over the weekend.` };
      }
      if (!rules.holding.allowOvernight) {
        return { kind: "BREACH", rule: "OVERNIGHT_HOLDING", minute: m.minute, measured: m.equity, floor: null, basis: null, detail: `${heldPositionsAtReset} position(s) held through the daily reset.` };
      }
    }
  }

  // Realized profit of the day (balance change since the last minute).
  const balanceChange = m.balance.minus(state.lastBalance);
  if (!balanceChange.isZero()) {
    const key = String(state.day);
    state.dayProfit[key] = dec(state.dayProfit[key] ?? 0).plus(balanceChange).toFixed(2);
  }
  // Intraday trailing high-water moves with every minute's tracked value.
  if (rules.maxLoss?.model === "INTRADAY_TRAILING") {
    const v = rules.maxLoss.basis === "BALANCE" ? m.balance : m.equity;
    if (v.greaterThan(state.highWater)) state.highWater = v.toFixed(2);
  }
  state.lastBalance = m.balance.toFixed(2);
  state.lastEquity = m.equity.toFixed(2);

  // ── Loss limits ─────────────────────────────────────────────────────────
  const floors = currentFloors(rules, state);
  if (rules.dailyLoss && floors.dailyLossFloor) {
    const measured = rules.dailyLoss.basis === "BALANCE" ? m.balance : m.adverseEquity;
    if (measured.lessThan(floors.dailyLossFloor)) {
      return { kind: "BREACH", rule: "DAILY_LOSS", minute: m.minute, measured, floor: floors.dailyLossFloor, basis: rules.dailyLoss.basis, detail: `Daily loss limit of ${rules.dailyLoss.limitPercent}% reached.` };
    }
  }
  if (rules.maxLoss && floors.maxLossFloor) {
    const measured = rules.maxLoss.basis === "BALANCE" ? m.balance : m.adverseEquity;
    if (measured.lessThan(floors.maxLossFloor)) {
      return { kind: "BREACH", rule: "MAX_LOSS", minute: m.minute, measured, floor: floors.maxLossFloor, basis: rules.maxLoss.basis, detail: `Maximum ${rules.maxLoss.model.toLowerCase().replace("_", " ")} loss of ${rules.maxLoss.limitPercent}% reached.` };
    }
  }

  // ── Objective ───────────────────────────────────────────────────────────
  if (rules.objective.profitTargetPercent != null && passConditions(rules, state, m).met) return { kind: "PASS", minute: m.minute };
  const maxDays = rules.objective.maxCalendarDays;
  if (maxDays != null && m.tradingDay - state.firstDay >= maxDays) {
    return { kind: "FAIL", minute: m.minute, reason: `The ${maxDays}-day limit ended without meeting the objective.` };
  }
  return { kind: "CONTINUE" };
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export interface PayoutInput {
  startingBalance: Decimal.Value;
  balance: Decimal.Value;
  openPositions: number;
  terms: NonNullable<SimRules["payout"]>;
  /** Calendar days since the funded account started / since the last payout. */
  daysSinceFunded: number;
  daysSinceLastPayout: number | null;
  tradingDaysInCycle: number;
}

export interface PayoutEvaluation {
  eligible: boolean;
  reasons: string[];
  /** Realized profit above the start + buffer (≥ 0). */
  eligibleProfit: Decimal;
  grossPayout: Decimal;
  traderShare: Decimal;
  firmShare: Decimal;
  balanceAfter: Decimal;
}

/**
 * Payout eligibility and split, from REALIZED balance only (floating PnL is
 * never withdrawn). The account keeps start + buffer; the gross payout is the
 * eligible profit (capped at the maximum) and is split per the terms:
 *   trader = round2(gross × split%), firm = gross − trader.
 * The balance after is balance − gross — never a reset to the start.
 */
export function evaluatePayout(input: PayoutInput): PayoutEvaluation {
  const t = input.terms;
  const start = dec(input.startingBalance);
  const balance = dec(input.balance);
  const buffer = start.times(t.profitBufferPercent).dividedBy(100);
  const raw = balance.minus(start).minus(buffer);
  const eligibleProfit = raw.greaterThan(0) ? raw.toDecimalPlaces(2, 1) : dec(0);
  let gross = eligibleProfit;
  if (t.maxPayoutAmount != null && gross.greaterThan(t.maxPayoutAmount)) gross = dec(t.maxPayoutAmount);
  const reasons: string[] = [];
  if (input.openPositions > 0) reasons.push("Close every open position before requesting a payout.");
  if (input.daysSinceLastPayout == null ? input.daysSinceFunded < t.firstPayoutAfterDays : input.daysSinceLastPayout < t.cycleDays) {
    reasons.push(
      input.daysSinceLastPayout == null
        ? `The first payout is available ${t.firstPayoutAfterDays} days after funding (day ${input.daysSinceFunded}).`
        : `Payouts are every ${t.cycleDays} days (day ${input.daysSinceLastPayout} of this cycle).`,
    );
  }
  if (input.tradingDaysInCycle < t.minTradingDaysPerCycle) reasons.push(`Trade on ${t.minTradingDaysPerCycle} days this cycle (${input.tradingDaysInCycle} so far).`);
  if (!gross.greaterThan(0)) reasons.push("There is no realized profit above the buffer to withdraw.");
  else if (gross.lessThan(t.minPayoutAmount)) reasons.push(`The minimum payout is ${dec(t.minPayoutAmount).toFixed(2)}.`);
  const traderShare = gross.times(t.profitSplitPercent).dividedBy(100).toDecimalPlaces(2, 4);
  return {
    eligible: reasons.length === 0,
    reasons,
    eligibleProfit,
    grossPayout: gross,
    traderShare,
    firmShare: gross.minus(traderShare),
    balanceAfter: balance.minus(gross),
  };
}
