import { describe, expect, it } from "vitest";

import { buildValidationDifference } from "@/domain/replay-comparison/validation-difference";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { ActualTradeComparisonSnapshot, ReplayTradeDTO } from "@/types/replay";

function makeValidationSnapshot(overrides: Partial<SetupValidationSnapshot> = {}): SetupValidationSnapshot {
  return {
    strategyName: "Strategy A",
    strategyVersion: 1,
    setupType: { id: "st-1", name: "Breakout" },
    scenario: { id: "sc-1", direction: "BULLISH" },
    conditions: [
      { checklistItemId: "c1", name: "Liquidity Sweep", mandatory: true, weight: 50, directionApplicability: "BOTH", checked: true, sortOrder: 1 },
      { checklistItemId: "c2", name: "Volume Confirmation", mandatory: false, weight: 20, directionApplicability: "BOTH", checked: false, sortOrder: 2 },
    ],
    score: 80,
    totalEligibleWeight: 70,
    selectedEligibleWeight: 50,
    mandatoryGateMet: true,
    missingMandatoryConditionNames: [],
    validationState: "VALIDATED",
    overrideReason: null,
    overrideNote: null,
    evaluatedAt: "2026-08-04T14:00:00.000Z",
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
    strategyId: "s-1",
    strategyName: "Strategy A",
    strategyVersion: 1,
    setupTypeName: "Breakout",
    scenarioDirection: "BULLISH",
    validationState: "VALIDATED",
    validationSnapshot: makeValidationSnapshot(),
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
    strategyNameSnapshot: "Strategy A",
    strategyVersionSnapshot: 1,
    setupTypeNameSnapshot: "Breakout",
    decisionType: "TAKEN",
    replayValidationSnapshot: makeValidationSnapshot(),
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

describe("buildValidationDifference", () => {
  it("is not comparable for a legacy pair (no actualSnapshot)", () => {
    const result = buildValidationDifference(null, makeReplay());
    expect(result.comparable).toBe(false);
    expect(result.incompatibilityReason).toMatch(/legacy/i);
  });

  it("is not comparable when strategy versions differ", () => {
    const actual = makeSnapshot({ strategyVersion: 1 });
    const replay = makeReplay({ strategyVersionSnapshot: 2 });
    const result = buildValidationDifference(actual, replay);
    expect(result.comparable).toBe(false);
    expect(result.incompatibilityReason).toMatch(/different historical strategy versions/i);
  });

  it("is not comparable when either side has no validation snapshot", () => {
    const actual = makeSnapshot({ validationSnapshot: null });
    const result = buildValidationDifference(actual, makeReplay());
    expect(result.comparable).toBe(false);
  });

  it("compares condition-by-condition when strategy/setup/scenario are compatible", () => {
    const actualVal = makeValidationSnapshot({
      conditions: [
        { checklistItemId: "c1", name: "Liquidity Sweep", mandatory: true, weight: 50, directionApplicability: "BOTH", checked: true, sortOrder: 1 },
        { checklistItemId: "c2", name: "Volume Confirmation", mandatory: false, weight: 20, directionApplicability: "BOTH", checked: true, sortOrder: 2 },
      ],
    });
    const replayVal = makeValidationSnapshot({
      conditions: [
        { checklistItemId: "c1", name: "Liquidity Sweep", mandatory: true, weight: 50, directionApplicability: "BOTH", checked: false, sortOrder: 1 },
        { checklistItemId: "c2", name: "Volume Confirmation", mandatory: false, weight: 20, directionApplicability: "BOTH", checked: true, sortOrder: 2 },
      ],
    });
    const actual = makeSnapshot({ validationSnapshot: actualVal });
    const replay = makeReplay({ replayValidationSnapshot: replayVal });

    const result = buildValidationDifference(actual, replay);
    expect(result.comparable).toBe(true);
    expect(result.checkedOnlyInActual).toEqual(["Liquidity Sweep"]);
    expect(result.checkedOnlyInReplay).toEqual([]);
    expect(result.mandatoryDifferenceNames).toEqual(["Liquidity Sweep"]); // mandatory + checked differs
  });
});
