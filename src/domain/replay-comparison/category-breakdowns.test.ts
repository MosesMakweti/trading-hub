import { describe, expect, it } from "vitest";

import { buildComparisonBreakdowns } from "@/domain/replay-comparison/category-breakdowns";
import type { ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

function makeActual(overrides: Partial<ActualTradeRefDTO> = {}): ActualTradeRefDTO {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyName: "Strategy A",
    setupTypeName: "Breakout",
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
    strategyNameSnapshot: "Strategy A",
    strategyVersionSnapshot: 1,
    setupTypeNameSnapshot: "Breakout",
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

describe("buildComparisonBreakdowns", () => {
  it("byDirection always includes both LONG and SHORT, even with zero data on one side", () => {
    const result = buildComparisonBreakdowns([makeActual({ direction: "LONG" })], []);
    expect(result.byDirection.map((r) => r.key)).toEqual(["LONG", "SHORT"]);
    expect(result.byDirection.find((r) => r.key === "SHORT")?.actualCount).toBe(0);
  });

  it("sums Actual R/count and Replay R/count independently per asset", () => {
    const actualTrades = [makeActual({ assetSymbol: "XAUUSD", realizedR: 1 }), makeActual({ tradeId: "t-2", assetSymbol: "EURUSD", realizedR: -1 })];
    const replayTrades = [makeReplay({ assetSymbol: "XAUUSD", realizedReplayR: 3 })];
    const result = buildComparisonBreakdowns(actualTrades, replayTrades);
    const gold = result.byAsset.find((r) => r.key === "XAUUSD")!;
    expect(gold.actualR).toBe(1);
    expect(gold.actualCount).toBe(1);
    expect(gold.replayR).toBe(3);
    expect(gold.replayTakenCount).toBe(1);
  });

  it("excludes cancelled Actual ideas from the Actual side", () => {
    const result = buildComparisonBreakdowns([makeActual({ isCancelled: true, realizedR: null })], []);
    expect(result.byAsset.find((r) => r.key === "XAUUSD")).toBeUndefined();
  });

  it("excludes SKIPPED Replay decisions from the Replay side", () => {
    const result = buildComparisonBreakdowns([], [makeReplay({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" })]);
    expect(result.byAsset.find((r) => r.key === "XAUUSD")).toBeUndefined();
  });

  it("falls back to 'No strategy'/'No Setup Type' when unset", () => {
    const result = buildComparisonBreakdowns([makeActual({ strategyName: null, setupTypeName: null })], []);
    expect(result.byStrategy.map((r) => r.key)).toEqual(["No strategy"]);
    expect(result.bySetupType.map((r) => r.key)).toEqual(["No Setup Type"]);
  });
});
