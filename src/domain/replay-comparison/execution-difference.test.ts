import { describe, expect, it } from "vitest";

import { buildExecutionDifference } from "@/domain/replay-comparison/execution-difference";
import type { ActualTradeComparisonSnapshot, ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

function makeActualRef(overrides: Partial<ActualTradeRefDTO> = {}): ActualTradeRefDTO {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyName: null,
    setupTypeName: null,
    validationState: null,
    reviewLifecycleStatus: "FULLY_CLOSED",
    isCancelled: false,
    winLossClass: "WIN",
    realizedR: 2,
    finalizedR: 2,
    pnl: 100,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ActualTradeComparisonSnapshot> = {}): ActualTradeComparisonSnapshot {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    ideaCreatedAt: "2026-08-04T13:00:00.000Z",
    executionStartedAt: "2026-08-04T14:00:00.000Z",
    closedAt: "2026-08-04T15:00:00.000Z",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    session: null,
    strategyId: null,
    strategyName: null,
    strategyVersion: null,
    setupTypeName: null,
    scenarioDirection: null,
    validationState: null,
    validationSnapshot: null,
    overrideReason: null,
    overrideNote: null,
    plannedEntry: 1900,
    plannedStopLoss: 1890,
    plannedTargets: [],
    plannedR: 2,
    actualEntry: 1900,
    actualStopLoss: 1890,
    resolvedInitialStop: 1890,
    partialExits: [],
    actualExit: 1920,
    realizedR: 2,
    finalizedR: 2,
    reviewLifecycleStatus: "FULLY_CLOSED",
    isCancelled: false,
    winLossClass: "WIN",
    behaviourLabels: [],
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    tradeIntent: null,
    dailyBiasSnapshot: null,
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
    validationState: null,
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

describe("buildExecutionDifference", () => {
  it("is not comparable for a legacy pair (no actualSnapshot)", () => {
    const result = buildExecutionDifference(null, makeActualRef(), makeReplay());
    expect(result.comparable).toBe(false);
    expect(result.entry.actual).toBeNull();
  });

  it("computes an R-normalized entry difference for a LONG", () => {
    // Actual entered at 1901 (1 point worse for a long than Replay's 1900),
    // risk = 10 points (1900 planned vs 1890 planned stop... here actual entry 1901, stop 1890 => risk 11).
    const actual = makeSnapshot({ actualEntry: 1901, actualStopLoss: 1890, resolvedInitialStop: 1890 });
    const replay = makeReplay({ simulatedEntry: 1900, plannedStopLoss: 1890 });
    const result = buildExecutionDifference(actual, makeActualRef(), replay);
    expect(result.comparable).toBe(true);
    expect(result.entry.signedDifference).toBeCloseTo(1900 - 1901, 4); // replay - actual = -1
    expect(result.entry.rDistance).toBeCloseTo(-1 / 11, 4);
  });

  it("carries frozen partial exits from both sides with timestamps/order", () => {
    const actual = makeSnapshot({
      partialExits: [{ order: 1, price: 1910, percentClosed: 50, exitedAt: "2026-08-04T14:30:00.000Z", realizedR: 1 }],
    });
    const replay = makeReplay({
      partialExits: [{ id: "p1", plannedTargetId: "tp1", source: "TARGET_HIT", exitPrice: 1915, percentClosed: 50, realizedR: 1.5, executedAt: "2026-08-04T14:45:00.000Z" }],
    });
    const result = buildExecutionDifference(actual, makeActualRef(), replay);
    expect(result.actualPartialExits).toEqual([{ order: 1, price: 1910, percentClosed: 50, timestamp: "2026-08-04T14:30:00.000Z", realizedR: 1 }]);
    expect(result.replayPartialExits[0]).toMatchObject({ price: 1915, percentClosed: 50, realizedR: 1.5 });
  });

  it("uses Replay's frozen ORIGINAL stop (plannedStopLoss), never a moved currentStopLoss", () => {
    const actual = makeSnapshot({ actualStopLoss: 1890, resolvedInitialStop: 1890 });
    const replay = makeReplay({ plannedStopLoss: 1890, currentStopLoss: 1895 }); // SL moved after fill
    const result = buildExecutionDifference(actual, makeActualRef(), replay);
    expect(result.initialStop.replay).toBe(1890);
  });

  it("same execution on both sides produces a zero difference, not a discrepancy", () => {
    const actual = makeSnapshot({ actualEntry: 1900, actualStopLoss: 1890, resolvedInitialStop: 1890 });
    const replay = makeReplay({ simulatedEntry: 1900, plannedStopLoss: 1890 });
    const result = buildExecutionDifference(actual, makeActualRef(), replay);
    expect(result.entry.signedDifference).toBe(0);
    expect(result.initialStop.signedDifference).toBe(0);
  });
});
