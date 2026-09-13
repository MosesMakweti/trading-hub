/**
 * Adapts the frozen `ReplayActualBaseline` (Stage 12) into the shared
 * `PeriodMetrics` shape (Stage 15 §4) — a pure mapping, no recomputation.
 * Comparison must read the SAME frozen numbers Edge Review's Overview tab
 * already shows for this period; it never re-queries live canonical
 * Analytics (see types.ts's module doc comment for why).
 */
import type { PeriodMetrics } from "@/domain/replay-comparison/types";
import type { ReplayActualBaseline } from "@/types/replay";

export function toActualPeriodMetrics(baseline: ReplayActualBaseline): PeriodMetrics {
  const overview = baseline.canonical.overview;
  const validatedTrades = baseline.actualTrades.filter(
    (t) => t.validationState === "VALIDATED" || t.validationState === "OVERRIDDEN",
  ).length;

  return {
    executedTrades: overview.totalExecutedTrades,
    finalizedTrades: overview.finalizedTrades,
    wins: overview.winningTrades,
    losses: overview.losingTrades,
    breakeven: overview.breakevenTrades,
    winRate: overview.winRate,
    totalRealizedR: overview.totalRealizedR,
    // The plain mean realized R across FULLY_CLOSED trades — Edge Review's
    // existing "Avg / Trade" (Stage 12), distinct from `overview.expectancy`
    // (which weights by win/loss probability, excluding breakevens from the
    // split). Using the same field Overview already renders keeps this
    // table consistent with the rest of Edge Review rather than introducing
    // a second "average R" definition.
    averageRPerTrade: baseline.averageRealizedR,
    expectancy: overview.expectancy,
    profitFactor: overview.profitFactor,
    validatedTrades,
    overrideCount: overview.overrideCount,
  };
}
