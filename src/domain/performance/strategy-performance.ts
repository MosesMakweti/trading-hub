import * as metrics from "@/domain/performance/metrics";

/**
 * Per-strategy performance (Future integration: "win-rate/RR/psychology by
 * strategy"). Pure and composed from the shared metrics functions so a strategy's
 * numbers are computed exactly like the global analytics — the only difference is
 * the input set (trades filtered to one strategy). `actualRR` here carries the
 * Performance Account contribution % (the app's single source of truth), same as
 * the analytics service; psychology/adherence come from each trade.
 */
export interface StrategyTradePoint extends metrics.TradeMetricInput {
  psychologyPercent: number | null;
  adherencePercent: number | null;
}

export interface StrategyPerformanceSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  averageRR: number | null;
  /** Sum of the per-trade contribution % (a normalized "total R"). */
  totalRR: number;
  profitFactor: number | null;
  expectancy: number | null;
  bestRR: number | null;
  worstRR: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  averagePsychologyPercent: number | null;
  averageAdherencePercent: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function summarizeStrategyPerformance(
  trades: StrategyTradePoint[],
): StrategyPerformanceSummary {
  const closedRRs = trades
    .map((t) => t.actualRR)
    .filter((rr): rr is number => rr !== null);
  const psych = trades
    .map((t) => t.psychologyPercent)
    .filter((v): v is number => v !== null);
  const adherence = trades
    .map((t) => t.adherencePercent)
    .filter((v): v is number => v !== null);

  return {
    totalTrades: trades.length,
    winningTrades: closedRRs.filter((rr) => rr > 0).length,
    losingTrades: closedRRs.filter((rr) => rr < 0).length,
    winRate: metrics.winRate(trades),
    averageRR: metrics.averageRR(trades),
    totalRR: closedRRs.reduce((sum, rr) => sum + rr, 0),
    profitFactor: metrics.profitFactor(trades),
    expectancy: metrics.expectancy(trades),
    bestRR: closedRRs.length ? Math.max(...closedRRs) : null,
    worstRR: closedRRs.length ? Math.min(...closedRRs) : null,
    longestWinStreak: metrics.longestWinStreak(trades),
    longestLossStreak: metrics.longestLossStreak(trades),
    averagePsychologyPercent: average(psych),
    averageAdherencePercent: average(adherence),
  };
}
