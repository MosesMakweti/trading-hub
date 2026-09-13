import { describe, expect, it } from "vitest";

import {
  aggregateReplayByAsset,
  aggregateReplayByDirection,
  aggregateReplayBySetupType,
  aggregateReplayByStrategy,
  aggregateReplayByValidationState,
  computeReplayPeriodMetrics,
  countReplayDecisionTypes,
  isReplayExecuted,
  isReplayFinalized,
  toReplayMetricInputs,
} from "@/domain/replay-comparison/replay-period-metrics";
import type { ReplayTradeDTO } from "@/types/replay";

let seq = 0;
function makeTrade(overrides: Partial<ReplayTradeDTO> = {}): ReplayTradeDTO {
  seq += 1;
  return {
    id: `rt-${seq}`,
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

describe("isReplayExecuted / isReplayFinalized", () => {
  it("SKIPPED is never executed", () => {
    expect(isReplayExecuted(makeTrade({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }))).toBe(false);
  });
  it("a cancelled pending order is never executed", () => {
    expect(isReplayExecuted(makeTrade({ lifecycle: "CANCELLED", simulatedEntry: null }))).toBe(false);
  });
  it("an unfilled pending order is not yet executed", () => {
    expect(isReplayExecuted(makeTrade({ lifecycle: "PENDING", simulatedEntry: null }))).toBe(false);
  });
  it("a filled, non-cancelled TAKEN trade is executed", () => {
    expect(isReplayExecuted(makeTrade({ lifecycle: "OPEN" }))).toBe(true);
  });
  it("only CLOSED trades are finalized", () => {
    expect(isReplayFinalized(makeTrade({ lifecycle: "OPEN" }))).toBe(false);
    expect(isReplayFinalized(makeTrade({ lifecycle: "PARTIALLY_CLOSED" }))).toBe(false);
    expect(isReplayFinalized(makeTrade({ lifecycle: "CLOSED" }))).toBe(true);
  });
});

describe("toReplayMetricInputs", () => {
  it("only includes CLOSED trades, using realizedReplayR as actualRR", () => {
    const trades = [makeTrade({ lifecycle: "CLOSED", realizedReplayR: 2 }), makeTrade({ lifecycle: "OPEN", realizedReplayR: 0 })];
    const inputs = toReplayMetricInputs(trades);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].actualRR).toBe(2);
  });
});

describe("computeReplayPeriodMetrics", () => {
  it("computes win/loss/breakeven/totalR/validated/override from a mixed set", () => {
    const trades = [
      makeTrade({ lifecycle: "CLOSED", realizedReplayR: 2, validationState: "VALIDATED" }),
      makeTrade({ lifecycle: "CLOSED", realizedReplayR: -1, validationState: "OVERRIDDEN" }),
      makeTrade({ lifecycle: "CLOSED", realizedReplayR: 0, validationState: "NOT_VALIDATED" }),
      makeTrade({ lifecycle: "OPEN", realizedReplayR: 0.5, validationState: "VALIDATED" }), // still open — counts toward totalR only
      makeTrade({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }), // excluded entirely
    ];
    const m = computeReplayPeriodMetrics(trades);
    expect(m.executedTrades).toBe(4);
    expect(m.finalizedTrades).toBe(3);
    expect(m.wins).toBe(1);
    expect(m.losses).toBe(1);
    expect(m.breakeven).toBe(1);
    expect(m.totalRealizedR).toBeCloseTo(2 - 1 + 0 + 0.5, 4);
    expect(m.validatedTrades).toBe(3); // VALIDATED x2 + OVERRIDDEN x1
    expect(m.overrideCount).toBe(1);
    expect(m.winRate).toBeCloseTo((1 / 3) * 100, 4);
  });

  it("returns nulls, not NaN/0, for an empty set", () => {
    const m = computeReplayPeriodMetrics([]);
    expect(m.winRate).toBeNull();
    expect(m.expectancy).toBeNull();
    expect(m.profitFactor).toBeNull();
    expect(m.averageRPerTrade).toBeNull();
    expect(m.totalRealizedR).toBe(0);
  });
});

describe("countReplayDecisionTypes", () => {
  it("counts TAKEN and SKIPPED independently", () => {
    const trades = [
      makeTrade({ decisionType: "TAKEN" }),
      makeTrade({ decisionType: "TAKEN" }),
      makeTrade({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }),
    ];
    expect(countReplayDecisionTypes(trades)).toEqual({ taken: 2, skipped: 1 });
  });
});

describe("breakdowns", () => {
  it("aggregateReplayBySetupType groups TAKEN decisions only, sorted by total R desc", () => {
    const trades = [
      makeTrade({ setupTypeNameSnapshot: "Breakout", realizedReplayR: 1 }),
      makeTrade({ setupTypeNameSnapshot: "Reversal", realizedReplayR: 3 }),
      makeTrade({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED", setupTypeNameSnapshot: "Reversal" }),
    ];
    const stats = aggregateReplayBySetupType(trades);
    expect(stats.map((s) => s.label)).toEqual(["Reversal", "Breakout"]);
    expect(stats.find((s) => s.label === "Reversal")?.executedTrades).toBe(1); // the SKIPPED one is excluded
  });

  it("aggregateReplayByStrategy falls back to 'No strategy'", () => {
    const stats = aggregateReplayByStrategy([makeTrade({ strategyNameSnapshot: null })]);
    expect(stats.map((s) => s.label)).toEqual(["No strategy"]);
  });

  it("aggregateReplayByDirection always returns both LONG and SHORT, even with zero data", () => {
    const stats = aggregateReplayByDirection([makeTrade({ direction: "LONG" })]);
    expect(stats.map((s) => s.key)).toEqual(["LONG", "SHORT"]);
    expect(stats.find((s) => s.key === "SHORT")?.executedTrades).toBe(0);
  });

  it("aggregateReplayByAsset groups by asset symbol", () => {
    const stats = aggregateReplayByAsset([makeTrade({ assetSymbol: "XAUUSD" }), makeTrade({ assetSymbol: "EURUSD" })]);
    expect(stats.map((s) => s.key).sort()).toEqual(["EURUSD", "XAUUSD"]);
  });

  it("aggregateReplayByValidationState labels a null state as 'No Setup Type used'", () => {
    const stats = aggregateReplayByValidationState([makeTrade({ validationState: null })]);
    expect(stats[0].label).toBe("No Setup Type used");
  });
});
