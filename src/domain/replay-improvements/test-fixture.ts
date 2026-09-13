/**
 * Shared fixture for Stage 16 domain tests — a minimal but fully-typed
 * `ActualVsReplayComparison` with every discrepancy bucket empty by
 * default, so each test only needs to override the one field it exercises.
 * Not a `.test.ts` file itself (vitest won't run it), just a helper module.
 */
import type { ActualVsReplayComparison } from "@/domain/replay-comparison/types";

export function makeComparison(overrides: Partial<ActualVsReplayComparison> = {}): ActualVsReplayComparison {
  return {
    sessionStatus: "COMPLETED",
    isProvisional: false,
    actual: {
      metrics: {
        executedTrades: 0,
        finalizedTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: null,
        totalRealizedR: 0,
        averageRPerTrade: null,
        expectancy: null,
        profitFactor: null,
        validatedTrades: 0,
        overrideCount: 0,
      },
    },
    replay: {
      metrics: {
        executedTrades: 0,
        finalizedTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: null,
        totalRealizedR: 0,
        averageRPerTrade: null,
        expectancy: null,
        profitFactor: null,
        validatedTrades: 0,
        overrideCount: 0,
      },
      decisionCounts: { taken: 0, skipped: 0 },
      bySetupType: [],
      byStrategy: [],
      byDirection: [],
      byAsset: [],
      byValidationState: [],
    },
    cumulativeR: { actual: [], replay: [] },
    matched: [],
    opportunity: { unmatchedActual: [], unmatchedReplayTaken: [], unmatchedReplaySkipped: [] },
    behaviour: {
      actualOverrideRate: null,
      replayOverrideRate: null,
      actualValidatedRate: null,
      replayValidatedRate: null,
      replaySkipRate: null,
    },
    discrepancy: {
      strategyVariance: { count: 0, entries: [] },
      executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
      behavioralDiscrepancy: { count: 0, events: [] },
      opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
      avoidableDiscrepancy: { totalR: 0, formula: "test formula" },
    },
    overrideAnalysis: {
      actual: { validated: 0, overridden: 0, notValidated: 0 },
      replay: { validated: 0, overridden: 0, skipped: 0 },
      actualOverrideReplaySkipped: 0,
      actualOverrideReplayValidated: 0,
      actualValidatedReplaySkipped: 0,
    },
    breakdowns: { byAsset: [], byStrategy: [], bySetupType: [], byDirection: [] },
    ...overrides,
  };
}
