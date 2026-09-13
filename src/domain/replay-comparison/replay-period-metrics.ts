/**
 * Replay-period aggregators (Stage 15 §5) — pure functions over
 * `ReplayTradeDTO[]`, deliberately mirroring canonical-aggregations.ts's
 * shape and reusing the SAME statistical engine (domain/performance/
 * metrics.ts's winRate/averageRR/expectancy/profitFactor) rather than a
 * second definition of any of those terms. `ReplayTrade` is never fed into
 * canonical Analytics and never joins the real Trade table — everything
 * here reads only the already-loaded `ReplayTradeDTO[]` for one session.
 */
import * as metrics from "@/domain/performance/metrics";
import type { TradeMetricInput } from "@/domain/performance/metrics";
import { utcDateToKey } from "@/lib/date";
import type { PeriodMetrics, ReplayDecisionTypeCounts, ReplayGroupStats } from "@/domain/replay-comparison/types";
import type { ReplayTradeDTO } from "@/types/replay";

const R_EPSILON = 0.001;

/** An order was actually placed and filled, and the order was never
 *  cancelled — the Replay equivalent of canonical's `isExecuted` (has an
 *  actual entry, isn't a cancelled idea). SKIPPED decisions and a PENDING
 *  order that never filled are excluded. */
export function isReplayExecuted(trade: ReplayTradeDTO): boolean {
  return trade.decisionType === "TAKEN" && trade.simulatedEntry != null && trade.lifecycle !== "CANCELLED";
}

/** A determined final result exists — the Replay equivalent of canonical's
 *  FULLY_CLOSED gate for win/loss/expectancy/profit-factor. */
export function isReplayFinalized(trade: ReplayTradeDTO): boolean {
  return trade.lifecycle === "CLOSED";
}

export function toReplayMetricInputs(trades: ReplayTradeDTO[]): TradeMetricInput[] {
  return trades.filter(isReplayFinalized).map((t) => ({
    dateKey: utcDateToKey(new Date(t.historicalTimestamp)),
    assetSymbol: t.assetSymbol,
    actualRR: t.realizedReplayR,
    strategyLabel: t.strategyNameSnapshot,
  }));
}

export function countReplayDecisionTypes(trades: ReplayTradeDTO[]): ReplayDecisionTypeCounts {
  return {
    taken: trades.filter((t) => t.decisionType === "TAKEN").length,
    skipped: trades.filter((t) => t.decisionType === "SKIPPED").length,
  };
}

/**
 * The one Replay period-metrics computation — every breakdown below (by
 * setup type, strategy, direction, asset, validation state) is this same
 * function applied to a filtered subset, exactly like canonical's
 * `computeRGroupStats`.
 */
export function computeReplayPeriodMetrics(trades: ReplayTradeDTO[]): PeriodMetrics {
  const executed = trades.filter(isReplayExecuted);
  const finalized = executed.filter(isReplayFinalized);
  const metricInputs = toReplayMetricInputs(trades);
  const wins = finalized.filter((t) => t.realizedReplayR > R_EPSILON);
  const losses = finalized.filter((t) => t.realizedReplayR < -R_EPSILON);
  const validated = executed.filter((t) => t.validationState === "VALIDATED" || t.validationState === "OVERRIDDEN");
  const overridden = executed.filter((t) => t.validationState === "OVERRIDDEN");

  return {
    executedTrades: executed.length,
    finalizedTrades: finalized.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: finalized.length - wins.length - losses.length,
    winRate: metrics.winRate(metricInputs),
    totalRealizedR: executed.reduce((sum, t) => sum + t.realizedReplayR, 0),
    averageRPerTrade: metrics.averageRR(metricInputs),
    expectancy: metrics.expectancy(metricInputs),
    profitFactor: metrics.profitFactor(metricInputs),
    validatedTrades: validated.length,
    overrideCount: overridden.length,
  };
}

/** Groups TAKEN decisions by a key and computes the same PeriodMetrics per
 *  group — SKIPPED decisions carry no execution data, so they're excluded
 *  from every performance breakdown (they still count toward
 *  `countReplayDecisionTypes` above). */
function groupReplayBy(
  trades: ReplayTradeDTO[],
  keyOf: (t: ReplayTradeDTO) => string | null,
  labelOf: (key: string) => string,
): ReplayGroupStats[] {
  const taken = trades.filter((t) => t.decisionType === "TAKEN");
  const byKey = new Map<string, ReplayTradeDTO[]>();
  for (const t of taken) {
    const key = keyOf(t);
    if (key == null) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(t);
  }
  return Array.from(byKey.entries()).map(([key, groupTrades]) => ({
    key,
    label: labelOf(key),
    ...computeReplayPeriodMetrics(groupTrades),
  }));
}

const NO_SETUP_TYPE = "__no_setup_type__";
export function aggregateReplayBySetupType(trades: ReplayTradeDTO[]): ReplayGroupStats[] {
  return groupReplayBy(
    trades,
    (t) => t.setupTypeNameSnapshot ?? NO_SETUP_TYPE,
    (key) => (key === NO_SETUP_TYPE ? "No Setup Type" : key),
  ).sort((a, b) => b.totalRealizedR - a.totalRealizedR);
}

const NO_STRATEGY = "__no_strategy__";
export function aggregateReplayByStrategy(trades: ReplayTradeDTO[]): ReplayGroupStats[] {
  return groupReplayBy(
    trades,
    (t) => t.strategyNameSnapshot ?? NO_STRATEGY,
    (key) => (key === NO_STRATEGY ? "No strategy" : key),
  ).sort((a, b) => b.totalRealizedR - a.totalRealizedR);
}

const DIRECTION_LABEL: Record<string, string> = { LONG: "Long", SHORT: "Short" };
export function aggregateReplayByDirection(trades: ReplayTradeDTO[]): ReplayGroupStats[] {
  const stats = groupReplayBy(
    trades,
    (t) => t.direction,
    (key) => DIRECTION_LABEL[key] ?? key,
  );
  return (["LONG", "SHORT"] as const).map(
    (d) => stats.find((s) => s.key === d) ?? { key: d, label: DIRECTION_LABEL[d], ...computeReplayPeriodMetrics([]) },
  );
}

export function aggregateReplayByAsset(trades: ReplayTradeDTO[]): ReplayGroupStats[] {
  return groupReplayBy(
    trades,
    (t) => t.assetSymbol,
    (key) => key,
  ).sort((a, b) => b.totalRealizedR - a.totalRealizedR);
}

const VALIDATION_LABEL: Record<string, string> = {
  VALIDATED: "Validated",
  OVERRIDDEN: "Overridden",
  NOT_VALIDATED: "Not validated",
  __none__: "No Setup Type used",
};
export function aggregateReplayByValidationState(trades: ReplayTradeDTO[]): ReplayGroupStats[] {
  return groupReplayBy(
    trades,
    (t) => t.validationState ?? "__none__",
    (key) => VALIDATION_LABEL[key] ?? key,
  );
}
