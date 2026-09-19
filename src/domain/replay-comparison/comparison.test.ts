import { describe, expect, it } from "vitest";

import { buildActualVsReplayComparison } from "@/domain/replay-comparison/comparison";
import type { ActualTradeRefDTO, ReplayActualBaseline, ReplayTradeDTO } from "@/types/replay";
import type { CanonicalAnalyticsSummary } from "@/server/services/analytics-canonical.service";

function makeBaseline(actualTrades: ActualTradeRefDTO[], overrideRate: number | null = 0): ReplayActualBaseline {
  const overview: CanonicalAnalyticsSummary["overview"] = {
    totalExecutedTrades: actualTrades.length,
    finalizedTrades: actualTrades.length,
    pendingTrades: 0,
    winningTrades: actualTrades.filter((t) => t.winLossClass === "WIN").length,
    losingTrades: actualTrades.filter((t) => t.winLossClass === "LOSS").length,
    breakevenTrades: 0,
    totalRealizedR: actualTrades.reduce((s, t) => s + (t.realizedR ?? 0), 0),
    totalPnl: 0,
    winRate: null,
    expectancy: null,
    profitFactor: null,
    averageWinnerR: null,
    averageLoserR: null,
    bestTradeR: null,
    worstTradeR: null,
    overrideCount: 0,
    overrideRate,
    cancelledCount: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
  };
  return {
    computedAt: "2026-08-04T00:00:00.000Z",
    range: { startDate: "2026-08-03", endDate: "2026-08-09" },
    scope: { strategyId: null, strategyName: null, assetSymbols: [] },
    canonical: { overview, cumulativeRCurve: [] } as unknown as CanonicalAnalyticsSummary,
    averageRealizedR: 0.5,
    psychologyAdherence: { averagePsychologyPercent: null, averageAdherencePercent: null, sampleSize: 0 },
    opportunity: { hasData: false, summary: {} as never },
    actualTrades,
  };
}

function makeActual(overrides: Partial<ActualTradeRefDTO> = {}): ActualTradeRefDTO {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyName: null,
    setupTypeName: null,
    validationState: "VALIDATED",
    reviewLifecycleStatus: "FULLY_CLOSED",
    isCancelled: false,
    winLossClass: "WIN",
    realizedR: 1,
    finalizedR: 1,
    pnl: 50,
    ...overrides,
  };
}

function makeReplay(overrides: Partial<ReplayTradeDTO> = {}): ReplayTradeDTO {
  return {
    id: "rt-1",
    historicalTimestamp: "2026-08-04T14:00:00.000Z",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyId: null,
    strategyNameSnapshot: null,
    strategyVersionSnapshot: null,
    setupTypeNameSnapshot: null,
    decisionType: "TAKEN",
    replayValidationSnapshot: null,
    validationState: "VALIDATED",
    overrideReason: null,
    overrideNote: null,
    lifecycle: "CLOSED",
    orderType: "MARKET",
    plannedEntry: 1900,
    plannedStopLoss: 1890,
    currentStopLoss: 1890,
    simulatedEntry: 1900,
    filledAt: "2026-08-04T14:00:00.000Z",
    simulatedExit: 1920,
    closedAt: "2026-08-04T15:00:00.000Z",
    closeReason: "TARGET",
    remainingPercent: 0,
    realizedReplayR: 2,
    lastProcessedTime: "2026-08-04T15:00:00.000Z",
    pendingAmbiguity: null,
    notes: null,
    targets: [],
    partialExits: [],
    executionEvents: [],
    ...overrides,
  };
}

describe("buildActualVsReplayComparison", () => {
  it("never feeds ReplayTrade rows into the Actual side, and vice versa", () => {
    const baseline = makeBaseline([makeActual({ realizedR: 1 })]);
    const replayTrades = [makeReplay({ realizedReplayR: 5 })];
    const result = buildActualVsReplayComparison(baseline, replayTrades);

    expect(result.actual.metrics.totalRealizedR).toBe(1); // untouched by Replay's 5R
    expect(result.replay.metrics.totalRealizedR).toBe(5); // untouched by Actual's 1R
  });

  it("does not conflate total-R delta with a diagnosis — the raw numbers are exposed, not a verdict", () => {
    const baseline = makeBaseline([makeActual({ realizedR: -1, finalizedR: -1, winLossClass: "LOSS" })]);
    const replayTrades = [makeReplay({ realizedReplayR: 2 })];
    const result = buildActualVsReplayComparison(baseline, replayTrades);

    const pair = result.matched[0];
    expect(pair.outcome.actualR).toBe(-1);
    expect(pair.outcome.replayR).toBe(2);
    expect(pair.outcome.deltaR).toBeCloseTo(3, 4);
    // No "mistake"/"error"/verdict field exists anywhere on the pair or its
    // sub-objects — only descriptive outcome/decision/validation/execution/
    // behaviour facts, plus match confidence/reason/source/classification
    // (Stage 15.1 §13, Stage 15.2 §2-3) which describe the PAIRING itself,
    // not the trader's performance.
    expect(Object.keys(pair)).toEqual([
      "dateKey",
      "assetSymbol",
      "actual",
      "replay",
      "outcome",
      "decision",
      "validation",
      "execution",
      "behaviour",
      "classification",
      "confidence",
      "reason",
      "source",
      "actualSnapshot",
    ]);
  });

  it("separates opportunity differences by TAKEN vs SKIPPED", () => {
    const baseline = makeBaseline([]);
    const replayTrades = [
      makeReplay({ id: "taken-1", decisionType: "TAKEN" }),
      makeReplay({ id: "skipped-1", decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }),
    ];
    const result = buildActualVsReplayComparison(baseline, replayTrades);
    expect(result.opportunity.unmatchedReplayTaken.map((e) => e.replay.id)).toEqual(["taken-1"]);
    expect(result.opportunity.unmatchedReplaySkipped.map((e) => e.replay.id)).toEqual(["skipped-1"]);
  });

  it("computes behaviour rates only from data both sides actually have", () => {
    const baseline = makeBaseline(
      [makeActual({ validationState: "VALIDATED" }), makeActual({ tradeId: "t-2", validationState: "OVERRIDDEN" })],
      50,
    );
    const replayTrades = [
      makeReplay({ id: "r1", validationState: "VALIDATED" }),
      makeReplay({ id: "r2", validationState: "OVERRIDDEN", overrideReason: "OTHER" }),
      makeReplay({ id: "r3", decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }),
    ];
    const result = buildActualVsReplayComparison(baseline, replayTrades);
    expect(result.behaviour.actualOverrideRate).toBe(50);
    expect(result.behaviour.replayOverrideRate).toBeCloseTo(50, 4); // 1 of 2 validated-or-overridden
    expect(result.behaviour.replaySkipRate).toBeCloseTo((1 / 3) * 100, 4);
  });
});
