/**
 * Pure, decimal-safe account/stage track-record math (spec §6). Consumes
 * already-fetched ledger entries + executions (account-scoped, or filtered
 * to one stageId by the caller for a stage-scoped summary — same core math,
 * different input slice, which is how stage/account/company/market levels
 * stay genuinely distinct per the spec). Never fabricates a stat it can't
 * support from the given data — every optional field is null when there's
 * nothing to compute it from.
 */
import { Decimal } from "decimal.js";

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

const NEVER_AFFECTS_BALANCE: ExecutionStatusLike[] = ["CANCELLED", "MISSED", "NOT_TAKEN"];

export interface TrackRecordLedgerEntry {
  amount: Decimal.Value;
  balanceAfter: Decimal.Value;
  occurredAt: Date;
  eventType: LedgerEventTypeLike;
}

export interface TrackRecordExecution {
  grossPnl: Decimal.Value | null;
  netPnl: Decimal.Value | null;
  plannedRiskAmount: Decimal.Value;
  /** Precomputed by the caller (plannedRiskAmount / risk base × 100) — track-record.ts
   *  stays pure and doesn't need basis-resolution context to average it. */
  riskPercentOfBase: number | null;
  actualR: Decimal.Value | null;
  status: ExecutionStatusLike;
  closedAt: Date | null;
  /** Trading-day bucket key (see domain/prop-firms/session-boundary.ts) — used to count distinct trading days. */
  dateKey: string;
}

export interface TrackRecordSummary {
  startingBalance: Decimal;
  currentBalance: Decimal;
  grossPnl: Decimal;
  netPnl: Decimal;
  roiPercent: number | null;
  /** Every participation regardless of status (spec §7 "Total participating trades"). */
  totalParticipatingTrades: number;
  /** EXECUTED/PARTIALLY_CLOSED/CLOSED — actually taken on this account, whether or not settled yet. */
  executedTrades: number;
  /** CANCELLED/MISSED/NOT_TAKEN — visible for review, never affecting balance. */
  missedOrCancelledTrades: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePercent: number | null;
  avgR: number | null;
  /** Sum of realized R across every closed, R-resolved execution. */
  totalR: number | null;
  avgRiskPercent: number | null;
  largestWin: Decimal | null;
  largestLoss: Decimal | null;
  /** Longest winning/losing streak across closed, PnL-resolved executions in chronological order. */
  longestWinStreak: number;
  longestLossStreak: number;
  /** The still-open streak as of the most recent closed trade — positive = current run of wins, negative = current run of losses, 0 = none/last was breakeven. */
  currentStreak: number;
  profitFactor: number | null;
  maxRealizedDrawdown: Decimal;
  currentDrawdown: Decimal;
  feesPaid: Decimal;
  payoutsReceived: Decimal;
  netReturnAfterCosts: Decimal;
  tradingDaysCompleted: number;
  lastActivityAt: Date | null;
}

const FEE_EVENT_TYPES: LedgerEventTypeLike[] = ["COMMISSION_FEE", "CHALLENGE_PURCHASE_FEE", "RESET_FEE", "ACTIVATION_FEE"];

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function longestStreak(sequence: boolean[]): number {
  let longest = 0;
  let current = 0;
  for (const isMatch of sequence) {
    current = isMatch ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

export function computeTrackRecord(
  entries: TrackRecordLedgerEntry[],
  executions: TrackRecordExecution[],
  startingBalance: Decimal.Value,
): TrackRecordSummary {
  const starting = new Decimal(startingBalance);
  const sortedEntries = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const currentBalance = sortedEntries.length > 0 ? new Decimal(sortedEntries[sortedEntries.length - 1].balanceAfter) : starting;

  let feesPaid = new Decimal(0);
  let payoutsReceived = new Decimal(0);
  for (const entry of sortedEntries) {
    if (FEE_EVENT_TYPES.includes(entry.eventType)) feesPaid = feesPaid.plus(new Decimal(entry.amount).abs());
    if (entry.eventType === "PAYOUT") payoutsReceived = payoutsReceived.plus(new Decimal(entry.amount).abs());
  }

  // Max realized / current drawdown from the ledger's running-balance curve
  // (peak-to-trough on actual balance, not just trade PnL).
  let peak = starting;
  let maxRealizedDrawdown = new Decimal(0);
  for (const entry of sortedEntries) {
    const balance = new Decimal(entry.balanceAfter);
    if (balance.greaterThan(peak)) peak = balance;
    const drawdown = peak.minus(balance);
    if (drawdown.greaterThan(maxRealizedDrawdown)) maxRealizedDrawdown = drawdown;
  }
  const currentDrawdown = Decimal.max(0, peak.minus(currentBalance));

  // Both CLOSED and PARTIALLY_CLOSED can carry a realized netPnl (a partial
  // close books the realized slice while the rest stays open) — same set
  // trade-executions.service.ts treats as "affects the account balance".
  const closedResolved = executions
    .filter((e) => (e.status === "CLOSED" || e.status === "PARTIALLY_CLOSED") && e.netPnl != null)
    .sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));

  let grossPnl = new Decimal(0);
  let netPnl = new Decimal(0);
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let largestWin: Decimal | null = null;
  let largestLoss: Decimal | null = null;
  let sumWins = new Decimal(0);
  let sumLosses = new Decimal(0);
  // 1 = win, -1 = loss, 0 = breakeven, in chronological order — the single
  // source both longest- and current-streak are derived from below.
  const resultSequence: (1 | -1 | 0)[] = [];

  for (const execution of closedResolved) {
    const pnl = new Decimal(execution.netPnl!);
    netPnl = netPnl.plus(pnl);
    if (execution.grossPnl != null) grossPnl = grossPnl.plus(execution.grossPnl);

    if (pnl.greaterThan(0)) {
      wins += 1;
      sumWins = sumWins.plus(pnl);
      if (largestWin == null || pnl.greaterThan(largestWin)) largestWin = pnl;
      resultSequence.push(1);
    } else if (pnl.lessThan(0)) {
      losses += 1;
      sumLosses = sumLosses.plus(pnl.abs());
      if (largestLoss == null || pnl.lessThan(largestLoss)) largestLoss = pnl;
      resultSequence.push(-1);
    } else {
      breakeven += 1;
      resultSequence.push(0);
    }
  }

  const decided = wins + losses;
  const avgR = average(
    executions.filter((e) => e.actualR != null).map((e) => new Decimal(e.actualR!).toNumber()),
  );
  const totalRValues = closedResolved.filter((e) => e.actualR != null).map((e) => new Decimal(e.actualR!));
  const totalR = totalRValues.length > 0 ? totalRValues.reduce((sum, r) => sum.plus(r), new Decimal(0)).toNumber() : null;
  const avgRiskPercent = average(
    executions.filter((e) => e.riskPercentOfBase != null).map((e) => e.riskPercentOfBase!),
  );

  // Current streak: the still-open run as of the most recent resolved
  // trade — positive N = N wins in a row right now, negative N = N losses,
  // 0 when there's no history yet or the last trade was breakeven.
  let currentStreak = 0;
  if (resultSequence.length > 0) {
    const last = resultSequence[resultSequence.length - 1];
    if (last !== 0) {
      let count = 0;
      for (let i = resultSequence.length - 1; i >= 0 && resultSequence[i] === last; i--) count += 1;
      currentStreak = last * count;
    }
  }

  const totalParticipatingTrades = executions.length;
  const executedTrades = executions.filter((e) => e.status === "EXECUTED" || e.status === "PARTIALLY_CLOSED" || e.status === "CLOSED").length;
  const missedOrCancelledTrades = executions.filter((e) => NEVER_AFFECTS_BALANCE.includes(e.status)).length;

  const tradingDayKeys = new Set(closedResolved.map((e) => e.dateKey));

  const lastLedgerActivity = sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].occurredAt : null;
  const lastExecutionActivity = closedResolved.length > 0 ? closedResolved[closedResolved.length - 1].closedAt : null;
  const lastActivityAt =
    lastLedgerActivity && lastExecutionActivity
      ? (lastLedgerActivity.getTime() >= lastExecutionActivity.getTime() ? lastLedgerActivity : lastExecutionActivity)
      : (lastLedgerActivity ?? lastExecutionActivity ?? null);

  return {
    startingBalance: starting,
    currentBalance,
    grossPnl,
    netPnl,
    roiPercent: starting.greaterThan(0) ? netPnl.dividedBy(starting).times(100).toNumber() : null,
    totalParticipatingTrades,
    executedTrades,
    missedOrCancelledTrades,
    totalTrades: closedResolved.length,
    wins,
    losses,
    breakeven,
    winRatePercent: decided > 0 ? (wins / decided) * 100 : null,
    avgR,
    totalR,
    avgRiskPercent,
    largestWin,
    largestLoss,
    longestWinStreak: longestStreak(resultSequence.map((s) => s === 1)),
    longestLossStreak: longestStreak(resultSequence.map((s) => s === -1)),
    currentStreak,
    profitFactor: sumLosses.greaterThan(0) ? sumWins.dividedBy(sumLosses).toNumber() : null,
    maxRealizedDrawdown,
    currentDrawdown,
    feesPaid,
    payoutsReceived,
    netReturnAfterCosts: netPnl.minus(feesPaid),
    tradingDaysCompleted: tradingDayKeys.size,
    lastActivityAt,
  };
}
