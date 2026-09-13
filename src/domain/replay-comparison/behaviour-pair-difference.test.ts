import { describe, expect, it } from "vitest";

import { buildBehaviourPairDifference } from "@/domain/replay-comparison/behaviour-pair-difference";
import type { ActualTradeComparisonSnapshot, ReplayTradeDTO } from "@/types/replay";

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
    validationState: "VALIDATED",
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

describe("buildBehaviourPairDifference", () => {
  it("flags Actual override vs Replay skip", () => {
    const actual = makeSnapshot({ validationState: "OVERRIDDEN" });
    const replay = makeReplay({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" });
    const result = buildBehaviourPairDifference(actual, replay);
    expect(result.actualOverridden).toBe(true);
    expect(result.actualTookReplaySkipped).toBe(true);
  });

  it("never fabricates Replay psychology — behaviour labels/mood/intent come only from the Actual snapshot", () => {
    const actual = makeSnapshot({
      behaviourLabels: [{ name: "FOMO", polarity: "NEGATIVE" }],
      preTradeMoodTags: ["Anxious"],
      preTradeMoodIntensity: 4,
      tradeIntent: "FOMO",
    });
    const result = buildBehaviourPairDifference(actual, makeReplay());
    expect(result.actualBehaviourLabels).toEqual([{ name: "FOMO", polarity: "NEGATIVE" }]);
    expect(result.actualMoodTags).toEqual(["Anxious"]);
    expect(result.actualTradeIntent).toBe("FOMO");
    // No field on the result claims a Replay-side mood/behaviour equivalent —
    // structurally verified by the type itself (no such field exists).
  });

  it("detects Replay's stop having moved from its frozen original", () => {
    const replay = makeReplay({ plannedStopLoss: 1890, currentStopLoss: 1895 });
    const result = buildBehaviourPairDifference(makeSnapshot(), replay);
    expect(result.replayStopMoved).toBe(true);
  });

  it("returns null (not a guess) for actualManualOrEarlyExit — not determinable from frozen evidence", () => {
    const result = buildBehaviourPairDifference(makeSnapshot(), makeReplay());
    expect(result.actualManualOrEarlyExit).toBeNull();
  });

  it("with no actual snapshot (legacy pair), context fields are empty, not fabricated", () => {
    const result = buildBehaviourPairDifference(null, makeReplay());
    expect(result.actualBehaviourLabels).toEqual([]);
    expect(result.actualMoodTags).toEqual([]);
    expect(result.actualTradeIntent).toBeNull();
  });
});
