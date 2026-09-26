/**
 * Backtesting Analytics (Stage 5/6) — the run-level analysis, composed ONLY
 * from the canonical analytics engine's pure functions over the run's own
 * canonical rows (plus its opportunities). No second calculation engine: the
 * difference from live Analytics is the dataset scope and the settlement
 * basis (price-derived), never the formulas.
 *
 * Time: every date-based figure uses the canonical row's `dateKey` — the
 * trade's SIMULATED market date — never when the record was typed in.
 */
import {
  aggregateByAsset,
  aggregateByBehaviourLabel,
  aggregateByConfluence,
  aggregateByDirection,
  aggregateByEntryModel,
  aggregateByExecutionConfirmation,
  aggregateByMonth,
  aggregateByMoodTag,
  aggregateByOverrideReason,
  aggregateBySession,
  aggregateBySetupType,
  aggregateByStrategy,
  aggregateByTimeframe,
  aggregateByValidationState,
  aggregateByWeekday,
  buildFinalizedRCurve,
  computeRGroupStats,
  summarizeRDrawdown,
  toMetricInputs,
  type BehaviourLabelStats,
  type FinalizedRCurvePoint,
  type RDrawdownSummary,
  type RGroupStats,
} from "@/domain/analytics/canonical-aggregations";
import type { CanonicalAnalyticsTradeRow } from "@/domain/analytics/canonical-dataset";
import { aggregateMissReasons, type MissReasonAggregate, type MissReasonKey } from "@/domain/analytics/miss-reasons";
import { summarizeAdherence, type AdherenceSummary, type AdherenceTradePoint } from "@/domain/performance/adherence-analytics";
import * as metrics from "@/domain/performance/metrics";
import type { SetupRating } from "@/domain/trades/setup-score";

export interface BacktestOpportunityInput {
  status: "PENDING" | "EXECUTED" | "MISSED" | "INVALIDATED" | "EXPIRED";
  setupValid: boolean | null;
  missReason: MissReasonKey | null;
  missedOutcome: "MISSED_WIN" | "MISSED_LOSS" | "MISSED_BREAKEVEN" | "MISSED_UNDETERMINED" | null;
  /** Trader-entered "if taken" R — self-reported, never derived. */
  missedRealizedR: number | null;
}

export interface SimulationModelInput {
  startingBalance: number | null;
  riskPercentPerTrade: number | null;
  currency: string | null;
}

export interface BacktestOverview {
  /** Executed (entered, not cancelled) trades. */
  totalTrades: number;
  /** Executed trades with a final result — the sample behind every ratio. */
  finalizedTrades: number;
  /** Executed but not yet fully closed. */
  openTrades: number;
  cancelledIdeas: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  /** Σ finalized R. */
  netR: number;
  /** Mean finalized R per trade (identical to expectancy in R terms). */
  averageR: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  averageWinnerR: number | null;
  averageLoserR: number | null;
  bestTradeR: number | null;
  worstTradeR: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface MissedTradeSummary {
  /** Valid spotted setups (scored valid: setupValid === true — the same
   *  population Day Summary's missed count uses) resolved EXECUTED or MISSED. */
  executedOpportunities: number;
  missedOpportunities: number;
  /** missed / (missed + executed); null with no resolved valid setup. */
  missRate: number | null;
  invalidated: number;
  expired: number;
  pending: number;
  outcomes: { missedWin: number; missedLoss: number; missedBreakeven: number; undetermined: number };
  /** Σ trader-entered missed R over determined misses — self-reported, labelled as such. */
  selfReportedMissedR: number | null;
  reasons: MissReasonAggregate;
}

export interface SimulationSummary {
  startingBalance: number;
  riskPercentPerTrade: number;
  currency: string | null;
  /** Fixed-risk model: 1R = startingBalance × risk% (no compounding). */
  riskPerR: number;
  endingBalance: number;
  returnPercent: number;
  /** Max drawdown as % of the peak simulated balance (≤ 0). */
  maxDrawdownPercent: number;
}

export interface BacktestAnalyticsSummary {
  overview: BacktestOverview;
  curve: FinalizedRCurvePoint[];
  drawdown: RDrawdownSummary | null;
  breakdowns: {
    asset: RGroupStats[];
    session: RGroupStats[];
    direction: RGroupStats[];
    timeframe: RGroupStats[];
    weekday: RGroupStats[];
    month: RGroupStats[];
    entryModel: RGroupStats[];
    setupType: RGroupStats[];
    /** Only when the run's trades span more than one strategy/version. */
    strategy: RGroupStats[];
  };
  confluences: RGroupStats[];
  executionConfirmations: RGroupStats[];
  adherence: AdherenceSummary;
  validation: {
    byState: RGroupStats[];
    overrideReasons: RGroupStats[];
    /** Mandatory confluences present vs missing at save time. */
    mandatoryGate: RGroupStats[];
    averageAdherencePercent: number | null;
  };
  psychology: {
    moodTags: RGroupStats[];
    behaviourLabels: BehaviourLabelStats[];
    averagePsychologyPercent: number | null;
    psychologySample: number;
  };
  missed: MissedTradeSummary;
  simulation: SimulationSummary | null;
}

const R_EPSILON = 0.001;
const average = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length);

function overviewOf(rows: CanonicalAnalyticsTradeRow[]): BacktestOverview {
  const executed = rows.filter((r) => r.isExecuted);
  const finalized = executed.filter((r) => r.finalizedR != null);
  const inputs = toMetricInputs(executed);
  const rs = finalized.map((r) => r.finalizedR!);
  return {
    totalTrades: executed.length,
    finalizedTrades: finalized.length,
    openTrades: executed.length - finalized.length,
    cancelledIdeas: rows.filter((r) => r.isCancelled).length,
    wins: finalized.filter((r) => r.winLossClass === "WIN").length,
    losses: finalized.filter((r) => r.winLossClass === "LOSS").length,
    breakevens: finalized.filter((r) => r.winLossClass === "BREAKEVEN").length,
    winRate: metrics.winRate(inputs),
    netR: rs.reduce((s, v) => s + v, 0),
    averageR: metrics.averageRR(inputs),
    expectancy: metrics.expectancy(inputs),
    profitFactor: metrics.profitFactor(inputs),
    averageWinnerR: metrics.averageWinner(inputs),
    averageLoserR: metrics.averageLoser(inputs),
    bestTradeR: rs.length ? Math.max(...rs) : null,
    worstTradeR: rs.length ? Math.min(...rs) : null,
    longestWinStreak: metrics.longestWinStreak(inputs),
    longestLossStreak: metrics.longestLossStreak(inputs),
  };
}

function adherencePoints(rows: CanonicalAnalyticsTradeRow[]): AdherenceTradePoint[] {
  return rows
    .filter((r) => r.isExecuted)
    .map((r) => ({
      win: r.finalizedR == null || Math.abs(r.finalizedR) <= R_EPSILON ? null : r.finalizedR > 0,
      dateKey: r.dateKey,
      confluences: r.confluences,
      confluencePercent: r.confluencePercent,
      executionPercent: r.executionPercent,
      tradeQualityPercent: r.tradeQualityPercent,
      setupScore: r.setupScore,
      setupRating: (r.setupRating as SetupRating | null) ?? null,
      direction: r.direction,
    }));
}

function mandatoryGate(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const present = rows.filter((r) => r.setupValid === true);
  const missing = rows.filter((r) => r.setupValid === false);
  return [
    ...(present.length ? [computeRGroupStats("MANDATORY_MET", "All mandatory confluences present", present)] : []),
    ...(missing.length ? [computeRGroupStats("MANDATORY_MISSING", "Mandatory confluence missing", missing)] : []),
  ];
}

export function summarizeMissedTrades(opportunities: BacktestOpportunityInput[]): MissedTradeSummary {
  const valid = opportunities.filter((o) => o.setupValid === true);
  const executed = valid.filter((o) => o.status === "EXECUTED").length;
  const missedRows = valid.filter((o) => o.status === "MISSED");
  const determined = missedRows.filter((o) => o.missedOutcome && o.missedOutcome !== "MISSED_UNDETERMINED" && o.missedRealizedR != null);
  return {
    executedOpportunities: executed,
    missedOpportunities: missedRows.length,
    missRate: executed + missedRows.length > 0 ? (missedRows.length / (executed + missedRows.length)) * 100 : null,
    invalidated: opportunities.filter((o) => o.status === "INVALIDATED").length,
    expired: opportunities.filter((o) => o.status === "EXPIRED").length,
    pending: opportunities.filter((o) => o.status === "PENDING").length,
    outcomes: {
      missedWin: missedRows.filter((o) => o.missedOutcome === "MISSED_WIN").length,
      missedLoss: missedRows.filter((o) => o.missedOutcome === "MISSED_LOSS").length,
      missedBreakeven: missedRows.filter((o) => o.missedOutcome === "MISSED_BREAKEVEN").length,
      undetermined: missedRows.filter((o) => o.missedOutcome == null || o.missedOutcome === "MISSED_UNDETERMINED").length,
    },
    selfReportedMissedR: determined.length ? determined.reduce((s, o) => s + o.missedRealizedR!, 0) : null,
    reasons: aggregateMissReasons(missedRows.map((o) => ({ reason: o.missReason, missedRealizedR: o.missedRealizedR }))),
  };
}

function simulationOf(model: SimulationModelInput, overview: BacktestOverview, drawdown: RDrawdownSummary | null): SimulationSummary | null {
  const { startingBalance, riskPercentPerTrade } = model;
  if (startingBalance == null || riskPercentPerTrade == null || startingBalance <= 0 || riskPercentPerTrade <= 0) return null;
  const riskPerR = (startingBalance * riskPercentPerTrade) / 100;
  const endingBalance = startingBalance + overview.netR * riskPerR;
  const peakBalance = startingBalance + (drawdown?.peakR ?? 0) * riskPerR;
  const maxDrawdownPercent = drawdown && peakBalance > 0 ? ((drawdown.maxDrawdownR * riskPerR) / peakBalance) * 100 : 0;
  return {
    startingBalance,
    riskPercentPerTrade,
    currency: model.currency,
    riskPerR,
    endingBalance,
    returnPercent: ((endingBalance - startingBalance) / startingBalance) * 100,
    maxDrawdownPercent,
  };
}

export function summarizeBacktestRun(
  rows: CanonicalAnalyticsTradeRow[],
  opportunities: BacktestOpportunityInput[],
  simulation: SimulationModelInput,
): BacktestAnalyticsSummary {
  const overview = overviewOf(rows);
  const curve = buildFinalizedRCurve(rows);
  const drawdown = summarizeRDrawdown(curve);
  const strategies = aggregateByStrategy(rows);
  const executed = rows.filter((r) => r.isExecuted);
  const psych = executed.map((r) => r.psychologyPercent).filter((v): v is number => v != null);
  const adherence = executed.map((r) => r.adherencePercent).filter((v): v is number => v != null);

  return {
    overview,
    curve,
    drawdown,
    breakdowns: {
      asset: aggregateByAsset(rows),
      session: aggregateBySession(rows),
      direction: aggregateByDirection(rows),
      timeframe: aggregateByTimeframe(rows),
      weekday: aggregateByWeekday(rows),
      month: aggregateByMonth(rows),
      entryModel: aggregateByEntryModel(rows),
      setupType: aggregateBySetupType(rows),
      strategy: strategies.length > 1 ? strategies : [],
    },
    confluences: aggregateByConfluence(rows),
    executionConfirmations: aggregateByExecutionConfirmation(rows),
    adherence: summarizeAdherence(adherencePoints(rows)),
    validation: {
      byState: aggregateByValidationState(rows),
      overrideReasons: aggregateByOverrideReason(rows),
      mandatoryGate: mandatoryGate(rows),
      averageAdherencePercent: average(adherence),
    },
    psychology: {
      moodTags: aggregateByMoodTag(rows),
      behaviourLabels: aggregateByBehaviourLabel(rows),
      averagePsychologyPercent: average(psych),
      psychologySample: psych.length,
    },
    missed: summarizeMissedTrades(opportunities),
    simulation: simulationOf(simulation, overview, drawdown),
  };
}
