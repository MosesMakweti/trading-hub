"use client";

/**
 * Single lazy boundary for every Recharts plot. All chart wrappers dynamic-import
 * from THIS module, so Turbopack emits ONE shared async chunk that carries the
 * Recharts runtime exactly once (loaded on first chart mount, reused by the rest)
 * instead of duplicating the ~294 KB library into a separate chunk per plot.
 */
export { EquityCurvePlot } from "./equity-curve-plot";
export { MonthlyReturnsPlot } from "./monthly-returns-plot";
export { PsychologyTrendPlot } from "./psychology-trend-plot";
export { DiscrepancyGapPlot } from "./discrepancy-gap-plot";
export { MiniEquityCurvePlot } from "./mini-equity-curve-plot";
export {
  SetupQualityPlot,
  ConfluenceWinRatePlot,
  SetupQualityTrendPlot,
} from "./adherence-charts-plot";
