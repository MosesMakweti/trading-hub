/**
 * Per-strategy / per-day trader-performance shape shared by the Today Daily
 * Analytics widget, the Journal day recap, and the Strategy Lab performance
 * tab. Stage 10.5: the summary itself is now built by
 * `toStrategyPerformanceSummary` (canonical-aggregations.ts) from the
 * canonical, R-primary dataset — `totalRR`/`averageRR`/`bestRR`/`worstRR` are
 * real R-multiples (Trade.actualRR-derived), not the legacy Performance
 * Account contribution %. This file keeps only the shared return shape.
 */
export interface StrategyPerformanceSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  averageRR: number | null;
  /** Sum of realized R across every executed (non-cancelled) trade — partial-aware. */
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
