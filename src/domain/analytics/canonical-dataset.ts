/**
 * Analytics consolidation (Stage 10 §2) — the ONE normalized, R-primary
 * dataset new Analytics aggregations build on. Pure and framework-free (no
 * Prisma types): every field is a plain value the service layer has already
 * pulled off frozen Trade columns/snapshots (Stage 4-8), so nothing here can
 * ever re-derive historical strategy/setup identity from live Strategy Lab
 * config. Reuses computeTradeExecutionSummary (Stage 8) for realized R/PnL —
 * no parallel math.
 *
 * Stage 10.5 (source-of-truth migration): this dataset is now the ONE
 * definition of trader-performance R for the whole app — `getDailyAnalytics`
 * and `getStrategyPerformance` (analytics.service.ts) both delegate to it via
 * `toStrategyPerformanceSummary` (canonical-aggregations.ts) rather than
 * walking the Performance-Account contribution-% ledger. `getAnalyticsData`
 * still owns genuine account/equity accounting (realized $ balance, drawdown,
 * opportunity/discrepancy inputs) — see that file's doc comment for the
 * remaining, intentional split between R (here) and $ (there).
 */
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import type { DirectionLike } from "@/domain/prop-firms/risk";

export type ReviewLifecycleStatusValue =
  | "FULLY_CLOSED"
  | "PARTIALLY_CLOSED"
  | "STILL_HOLDING"
  | "CANCELLED_NEVER_TRIGGERED"
  | null;

export type ValidationStateValue = "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;

export type BiasAlignmentValue = "ALIGNED" | "CONFLICT" | "NEUTRAL_OR_NONE";

export type WinLossClass = "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | "CANCELLED";

export interface CanonicalBehaviourLabel {
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
}

export interface CanonicalTradeRowInput {
  tradeId: string;
  /** "YYYY-MM-DD". */
  dateKey: string;
  direction: DirectionLike;
  assetSymbol: string;
  strategyId: string | null;
  strategyName: string | null;
  session: string | null;
  reviewLifecycleStatus: ReviewLifecycleStatusValue;
  validationState: ValidationStateValue;
  overrideReason: string | null;
  setupTypeName: string | null;
  /** The frozen Stage 4 validation score (0-100), if a Setup Type was used. */
  validationScore: number | null;
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
  /** Trade.expectedRR — the confirmed plan's weighted planned R. */
  plannedR: number | null;
  /** Trade.actualRR — frozen once FULLY_CLOSED (Stage 7's automatic sync). */
  actualRR: number | null;
  actualEntry: number | null;
  actualStopLoss: number | null;
  actualExit: number | null;
  resolvedInitialStop: number | null;
  partials: { exitPrice: number; percentClosed: number | null }[];
  settled: boolean;
  settledRealizedR: number | null;
  settledPnl: number | null;
  preTradeMoodTags: string[];
  moodIntensity: number | null;
  behaviourLabels: CanonicalBehaviourLabel[];
  adherencePercent: number | null;
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
  /** Trade.psychology.psychologyPercent — carried through so daily/strategy
   *  consolidation (Stage 10.5) can report psychology alongside R without a
   *  second query or a parallel psychology-point pipeline. */
  psychologyPercent: number | null;
  // ── Backtesting Analytics (Stage 5/6) — additive, optional. Every value is
  // read from frozen trade columns / the trade's own strategyExecutionSnapshot,
  // never re-resolved from live Strategy Lab config. Omitted = unknown.
  /** Chart timeframe of the plan (Trade.timeframe). */
  timeframe?: string | null;
  /** Trade.selectedEntryModel. */
  entryModel?: string | null;
  /** Selected confluences, labelled with their frozen direction applicability
   *  when direction-specific ("Liquidity sweep · Bullish"). */
  confluences?: string[];
  /** Selected execution confirmations (names). */
  executionConfirmations?: string[];
  setupScore?: number | null;
  setupRating?: string | null;
  /** false = a mandatory confluence was missing at save time. */
  setupValid?: boolean | null;
}

export interface CanonicalAnalyticsTradeRow {
  tradeId: string;
  dateKey: string;
  /** 0 (Sun) – 6 (Sat), UTC. */
  weekday: number;
  /** "YYYY-MM". */
  monthKey: string;
  assetSymbol: string;
  direction: DirectionLike;
  strategyId: string | null;
  strategyName: string | null;
  setupTypeName: string | null;
  session: string | null;
  reviewLifecycleStatus: ReviewLifecycleStatusValue;
  validationState: ValidationStateValue;
  validationScore: number | null;
  overrideReason: string | null;
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
  biasAlignment: BiasAlignmentValue;
  plannedR: number | null;
  /** Sum-safe realized R — includes a partial/still-holding trade's
   *  legitimately-realized-so-far R (Stage 10 §6), null for cancelled/unexecuted. */
  realizedR: number | null;
  /** Only set once FULLY_CLOSED — the sole input to win/loss/expectancy stats
   *  (a still-open position has no determined result yet). */
  finalizedR: number | null;
  /** Only set once the Performance Account has actually settled this trade. */
  pnl: number | null;
  winLossClass: WinLossClass;
  preTradeMoodTags: string[];
  moodIntensity: number | null;
  behaviourLabels: CanonicalBehaviourLabel[];
  adherencePercent: number | null;
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
  psychologyPercent: number | null;
  timeframe: string | null;
  entryModel: string | null;
  confluences: string[];
  executionConfirmations: string[];
  setupScore: number | null;
  setupRating: string | null;
  setupValid: boolean | null;
  /** Has an actual entry and isn't cancelled — the "executed trades" count
   *  everywhere in this stage's spec means exactly this. */
  isExecuted: boolean;
  isCancelled: boolean;
}

const R_EPSILON = 0.001;

/**
 * THE win/loss rule, shared by Analytics (this module) and the Journal's day
 * summaries (close-day.service.ts) so the two can never disagree about the
 * same trade: a trade has a result only once it is settled (Performance
 * Account settlement for LIVE, price-derived settlement for BACKTEST), and
 * that result classifies it. The trader's manual review status (FULLY_CLOSED)
 * plays no part. Null = no determined result yet.
 */
export function settledWinLossClass(summary: {
  settled: boolean;
  realizedRSoFar: number | null;
}): "WIN" | "LOSS" | "BREAKEVEN" | null {
  if (!summary.settled || summary.realizedRSoFar == null) return null;
  const r = summary.realizedRSoFar;
  return r > R_EPSILON ? "WIN" : r < -R_EPSILON ? "LOSS" : "BREAKEVEN";
}

export function buildCanonicalTradeRow(input: CanonicalTradeRowInput): CanonicalAnalyticsTradeRow {
  const weekday = new Date(`${input.dateKey}T00:00:00Z`).getUTCDay();
  const monthKey = input.dateKey.slice(0, 7);
  const isCancelled = input.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED";
  const isExecuted = !isCancelled && input.actualEntry != null;

  let realizedR: number | null = null;
  let finalizedR: number | null = null;
  let pnl: number | null = null;
  let winLossClass: WinLossClass = isCancelled ? "CANCELLED" : "PENDING";

  if (isExecuted) {
    const summary = computeTradeExecutionSummary({
      direction: input.direction,
      actualEntry: input.actualEntry,
      actualStopLoss: input.actualStopLoss,
      actualExit: input.actualExit,
      resolvedInitialStop: input.resolvedInitialStop,
      partials: input.partials,
      settled: input.settled,
      settledRealizedR: input.settledRealizedR,
      settledPnl: input.settledPnl,
    });
    realizedR = summary.realizedRSoFar;
    pnl = summary.pnl;

    // Analytics V2 — gate "finalized" on the canonical Performance-settled
    // fact (isPerformanceSettled's own definition: the position is fully
    // closed and a real result exists), never on reviewLifecycleStatus.
    // Those are independent write paths (settlePerformanceTrade vs the
    // trader's own setReviewLifecycleStatus confirmation): a trade can be
    // genuinely settled — real realizedR, real PnL — before the trader ever
    // opens Trade Review to mark it FULLY_CLOSED. Gating on the manual
    // status silently excluded such trades from win rate/profit
    // factor/expectancy/every breakdown, undercounting real, determined
    // results. `summary.settled` already reduces to exactly this fact.
    const settledClass = settledWinLossClass(summary);
    if (settledClass != null) {
      finalizedR = realizedR;
      winLossClass = settledClass;
    }
  }

  const dailyBias = input.dailyBiasSnapshot;
  const biasAlignment: BiasAlignmentValue =
    dailyBias == null || dailyBias === "NEUTRAL" ? "NEUTRAL_OR_NONE" : dailyBias === input.direction ? "ALIGNED" : "CONFLICT";

  return {
    tradeId: input.tradeId,
    dateKey: input.dateKey,
    weekday,
    monthKey,
    assetSymbol: input.assetSymbol,
    direction: input.direction,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    setupTypeName: input.setupTypeName,
    session: input.session,
    reviewLifecycleStatus: input.reviewLifecycleStatus,
    validationState: input.validationState,
    validationScore: input.validationScore,
    overrideReason: input.overrideReason,
    dailyBiasSnapshot: dailyBias,
    biasAlignment,
    plannedR: input.plannedR,
    realizedR,
    finalizedR,
    pnl,
    winLossClass,
    preTradeMoodTags: input.preTradeMoodTags,
    moodIntensity: input.moodIntensity,
    behaviourLabels: input.behaviourLabels,
    adherencePercent: input.adherencePercent,
    confluencePercent: input.confluencePercent,
    executionPercent: input.executionPercent,
    tradeQualityPercent: input.tradeQualityPercent,
    psychologyPercent: input.psychologyPercent,
    timeframe: input.timeframe ?? null,
    entryModel: input.entryModel ?? null,
    confluences: input.confluences ?? [],
    executionConfirmations: input.executionConfirmations ?? [],
    setupScore: input.setupScore ?? null,
    setupRating: input.setupRating ?? null,
    setupValid: input.setupValid ?? null,
    isExecuted,
    isCancelled,
  };
}
