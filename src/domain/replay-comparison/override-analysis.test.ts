import { describe, expect, it } from "vitest";

import { buildOverrideAnalysis } from "@/domain/replay-comparison/override-analysis";
import type { MatchedDecisionPair } from "@/domain/replay-comparison/types";
import type { ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

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

describe("buildOverrideAnalysis", () => {
  it("counts Actual and Replay validation states independently", () => {
    const actualTrades = [
      makeActual({ tradeId: "a1", validationState: "VALIDATED" }),
      makeActual({ tradeId: "a2", validationState: "OVERRIDDEN" }),
      makeActual({ tradeId: "a3", validationState: "NOT_VALIDATED" }),
    ];
    const replayTrades = [
      makeReplay({ id: "r1", decisionType: "TAKEN", validationState: "VALIDATED" }),
      makeReplay({ id: "r2", decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }),
    ];
    const result = buildOverrideAnalysis(actualTrades, replayTrades, []);
    expect(result.actual).toEqual({ validated: 1, overridden: 1, notValidated: 1 });
    expect(result.replay).toEqual({ validated: 1, overridden: 0, skipped: 1 });
  });

  it("flags the three named review cases from matched pairs only", () => {
    const pairBase: Pick<MatchedDecisionPair, "decision" | "replay"> = {
      decision: {
        actualDirection: "LONG",
        replayDirection: "LONG",
        sameDirection: true,
        actualStrategyName: null,
        replayStrategyName: null,
        sameStrategy: true,
        actualSetupTypeName: null,
        replaySetupTypeName: null,
        sameSetupType: true,
        actualValidationState: "OVERRIDDEN",
        replayValidationState: "VALIDATED",
        sameValidationState: false,
        actualDailyBiasSnapshot: null,
        replayDecisionType: "SKIPPED",
      },
      replay: makeReplay({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" }),
    };
    const overrideVsSkip = { ...pairBase } as MatchedDecisionPair;
    const validatedVsSkip = {
      ...pairBase,
      decision: { ...pairBase.decision, actualValidationState: "VALIDATED" as const },
    } as MatchedDecisionPair;

    const result = buildOverrideAnalysis([], [], [overrideVsSkip, validatedVsSkip]);
    expect(result.actualOverrideReplaySkipped).toBe(1);
    expect(result.actualValidatedReplaySkipped).toBe(1);
  });
});
