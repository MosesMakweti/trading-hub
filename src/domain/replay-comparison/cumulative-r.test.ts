import { describe, expect, it } from "vitest";

import { buildReplayCumulativeRCurve } from "@/domain/replay-comparison/cumulative-r";
import type { ReplayTradeDTO } from "@/types/replay";

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

describe("buildReplayCumulativeRCurve", () => {
  it("starts at 0 and accumulates in chronological order", () => {
    const trades = [
      makeReplay({ id: "a", closedAt: "2026-08-05T00:00:00.000Z", realizedReplayR: -1 }),
      makeReplay({ id: "b", closedAt: "2026-08-04T00:00:00.000Z", realizedReplayR: 2 }), // earlier, out of insertion order
    ];
    const curve = buildReplayCumulativeRCurve(trades);
    expect(curve.map((p) => p.id)).toEqual(["b", "a"]);
    expect(curve[0].cumulativeR).toBe(2);
    expect(curve[1].cumulativeR).toBe(1);
  });

  it("only includes finalized (CLOSED) TAKEN trades — SKIPPED and still-open contribute nothing", () => {
    const trades = [
      makeReplay({ id: "closed", lifecycle: "CLOSED", realizedReplayR: 1 }),
      makeReplay({ id: "open", lifecycle: "OPEN", realizedReplayR: 0.5 }),
      makeReplay({ id: "skipped", decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED", realizedReplayR: 0 }),
    ];
    const curve = buildReplayCumulativeRCurve(trades);
    expect(curve.map((p) => p.id)).toEqual(["closed"]);
  });
});
