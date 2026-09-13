import { describe, expect, it } from "vitest";

import { matchActualToReplayDecisions } from "@/domain/replay-comparison/decision-matching";
import type { ManualComparisonLink } from "@/domain/replay-comparison/types";
import type { ActualTradeComparisonSnapshot, ActualTradeRefDTO, ReplayActualBaseline, ReplayTradeDTO } from "@/types/replay";

let seq = 0;

function makeActual(overrides: Partial<ActualTradeRefDTO> = {}): ActualTradeRefDTO {
  seq += 1;
  return {
    tradeId: `t-${seq}`,
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyName: "Strategy A",
    setupTypeName: "Breakout",
    validationState: "VALIDATED",
    reviewLifecycleStatus: "FULLY_CLOSED",
    isCancelled: false,
    winLossClass: "WIN",
    realizedR: 2,
    finalizedR: 2,
    pnl: 100,
    ...overrides,
  };
}

function makeReplay(overrides: Partial<ReplayTradeDTO> = {}): ReplayTradeDTO {
  seq += 1;
  return {
    id: `rt-${seq}`,
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

function makeSnapshot(overrides: Partial<ActualTradeComparisonSnapshot> = {}): ActualTradeComparisonSnapshot {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    ideaCreatedAt: "2026-08-04T13:00:00.000Z",
    executionStartedAt: "2026-08-04T14:00:00.000Z",
    closedAt: "2026-08-04T15:00:00.000Z",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    session: "London",
    strategyId: "s-1",
    strategyName: "Strategy A",
    strategyVersion: 1,
    setupTypeName: "Breakout",
    scenarioDirection: "BULLISH",
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
    tradeIntent: "PLANNED",
    dailyBiasSnapshot: "LONG",
    ...overrides,
  };
}

function legacyBaseline(actualTrades: ActualTradeRefDTO[]): Pick<ReplayActualBaseline, "actualTrades" | "actualTradeSnapshots" | "schemaVersion"> {
  return { actualTrades };
}

function enrichedBaseline(
  actualTrades: ActualTradeRefDTO[],
  actualTradeSnapshots: ActualTradeComparisonSnapshot[],
): Pick<ReplayActualBaseline, "actualTrades" | "actualTradeSnapshots" | "schemaVersion"> {
  return { actualTrades, actualTradeSnapshots, schemaVersion: 2 };
}

describe("legacy path — no actualTradeSnapshots (pre-15.1 baseline)", () => {
  it("pairs by (dateKey, assetSymbol) in array order, tagged MEDIUM/LEGACY_BASELINE_FALLBACK", () => {
    const actual = makeActual();
    const replay = makeReplay();
    const result = matchActualToReplayDecisions(legacyBaseline([actual]), [replay]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBe("MEDIUM");
    expect(result.matched[0].reason).toBe("LEGACY_BASELINE_FALLBACK");
    expect(result.matched[0].actualSnapshot).toBeNull();
  });

  it("never matches across different assets or different days", () => {
    const actual = makeActual({ assetSymbol: "XAUUSD", dateKey: "2026-08-04" });
    const replayDiffAsset = makeReplay({ assetSymbol: "EURUSD" });
    const replayDiffDay = makeReplay({ historicalTimestamp: "2026-08-05T14:00:00.000Z" });
    const result = matchActualToReplayDecisions(legacyBaseline([actual]), [replayDiffAsset, replayDiffDay]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedActual).toHaveLength(1);
    expect(result.unmatchedReplayTaken).toHaveLength(2);
  });

  it("separates unmatched TAKEN from unmatched SKIPPED Replay decisions", () => {
    const taken = makeReplay({ decisionType: "TAKEN" });
    const skipped = makeReplay({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED" });
    const result = matchActualToReplayDecisions(legacyBaseline([]), [taken, skipped]);
    expect(result.unmatchedReplayTaken.map((e) => e.replay.id)).toEqual([taken.id]);
    expect(result.unmatchedReplaySkipped.map((e) => e.replay.id)).toEqual([skipped.id]);
  });

  it("a SKIPPED Replay decision matched to an Actual trade has a null replay R, not zero", () => {
    const actual = makeActual({ realizedR: 1 });
    const replay = makeReplay({ decisionType: "SKIPPED", simulatedEntry: null, lifecycle: "PLANNED", realizedReplayR: 0 });
    const result = matchActualToReplayDecisions(legacyBaseline([actual]), [replay]);
    expect(result.matched[0].outcome.replayR).toBeNull();
    expect(result.matched[0].outcome.deltaR).toBeNull();
  });
});

describe("enriched path — evidence-scored matching (Stage 15.1)", () => {
  it("scores a fully-agreeing pair as HIGH confidence / EXACT_CONTEXT_MATCH", () => {
    const actualRef = makeActual();
    const snapshot = makeSnapshot({ tradeId: actualRef.tradeId });
    const replay = makeReplay({ historicalTimestamp: "2026-08-04T14:05:00.000Z" }); // 5 min from executionStartedAt
    const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBe("HIGH");
    expect(result.matched[0].reason).toBe("EXACT_CONTEXT_MATCH");
    expect(result.matched[0].actualSnapshot?.tradeId).toBe(actualRef.tradeId);
  });

  it("opposite direction does not get falsely paired — left unmatched, not force-matched", () => {
    const actualRef = makeActual({ direction: "LONG", strategyName: null, setupTypeName: null });
    const snapshot = makeSnapshot({ tradeId: actualRef.tradeId, direction: "LONG", strategyName: null, setupTypeName: null });
    const replay = makeReplay({ direction: "SHORT", strategyNameSnapshot: null, setupTypeNameSnapshot: null });
    const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedActual).toHaveLength(1);
    expect(result.unmatchedReplayTaken).toHaveLength(1);
  });

  it("same strategy/setup/time improves confidence from MEDIUM to HIGH", () => {
    const actualRef = makeActual();
    const weakSnapshot = makeSnapshot({ tradeId: actualRef.tradeId, strategyName: null, setupTypeName: null, executionStartedAt: "2026-08-04T09:00:00.000Z" });
    const weakReplay = makeReplay({ strategyNameSnapshot: null, setupTypeNameSnapshot: null, historicalTimestamp: "2026-08-04T14:00:00.000Z" });
    const weakResult = matchActualToReplayDecisions(enrichedBaseline([actualRef], [weakSnapshot]), [weakReplay]);
    expect(weakResult.matched[0]?.confidence).toBe("MEDIUM");

    const strongSnapshot = makeSnapshot({ tradeId: actualRef.tradeId });
    const strongReplay = makeReplay({ historicalTimestamp: "2026-08-04T14:02:00.000Z" });
    const strongResult = matchActualToReplayDecisions(enrichedBaseline([actualRef], [strongSnapshot]), [strongReplay]);
    expect(strongResult.matched[0]?.confidence).toBe("HIGH");
  });

  it("two same-asset trades on the same day match correctly using strategy/direction evidence, not array order", () => {
    const actualA = makeActual({ tradeId: "a-1", direction: "LONG", strategyName: "Strategy A" });
    const actualB = makeActual({ tradeId: "a-2", direction: "SHORT", strategyName: "Strategy B" });
    const snapA = makeSnapshot({ tradeId: "a-1", direction: "LONG", strategyName: "Strategy A" });
    const snapB = makeSnapshot({ tradeId: "a-2", direction: "SHORT", strategyName: "Strategy B" });

    // Replay decisions arrive in the OPPOSITE order from the actuals —
    // array-order pairing would wrongly cross-match; scoring must not.
    const replayForB = makeReplay({ direction: "SHORT", strategyNameSnapshot: "Strategy B" });
    const replayForA = makeReplay({ direction: "LONG", strategyNameSnapshot: "Strategy A" });

    const result = matchActualToReplayDecisions(enrichedBaseline([actualA, actualB], [snapA, snapB]), [replayForB, replayForA]);
    expect(result.matched).toHaveLength(2);
    const pairA = result.matched.find((m) => m.actual.tradeId === "a-1");
    const pairB = result.matched.find((m) => m.actual.tradeId === "a-2");
    expect(pairA?.replay.id).toBe(replayForA.id);
    expect(pairB?.replay.id).toBe(replayForB.id);
  });

  it("ambiguous (similarly-strong) candidates are matched but capped at MEDIUM, never guessed at HIGH", () => {
    const actualRef = makeActual({ strategyName: null, setupTypeName: null });
    const snapshot = makeSnapshot({ tradeId: actualRef.tradeId, strategyName: null, setupTypeName: null, executionStartedAt: "2026-08-04T14:00:00.000Z" });
    // Two replay candidates with near-identical (tied) direction-only scores.
    const replay1 = makeReplay({ strategyNameSnapshot: null, setupTypeNameSnapshot: null, historicalTimestamp: "2026-08-04T14:10:00.000Z" });
    const replay2 = makeReplay({ strategyNameSnapshot: null, setupTypeNameSnapshot: null, historicalTimestamp: "2026-08-04T14:12:00.000Z" });
    const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay1, replay2]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].confidence).toBe("MEDIUM");
  });

  it("enforces one-to-one — an Actual trade never matches two Replay decisions and vice versa", () => {
    const actualRef = makeActual();
    const snapshot = makeSnapshot({ tradeId: actualRef.tradeId });
    const replay1 = makeReplay({ historicalTimestamp: "2026-08-04T14:01:00.000Z" });
    const replay2 = makeReplay({ historicalTimestamp: "2026-08-04T14:02:00.000Z" });
    const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay1, replay2]);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedReplayTaken).toHaveLength(1);
  });

  describe("manual links (Stage 15.1 §16)", () => {
    it("a MANUAL MATCHED link forces the pairing at HIGH confidence, overriding the algorithm", () => {
      const actualRef = makeActual({ direction: "LONG" });
      const snapshot = makeSnapshot({ tradeId: actualRef.tradeId, direction: "LONG" });
      const replay = makeReplay({ direction: "SHORT" }); // would otherwise score negatively / go unmatched
      const links: ManualComparisonLink[] = [{ actualTradeId: actualRef.tradeId, replayTradeId: replay.id, linkType: "MATCHED" }];
      const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay], links);
      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].confidence).toBe("HIGH");
      expect(result.matched[0].reason).toBe("MANUAL_LINK");
    });

    it("an EXCLUDED link suppresses a specific pairing the algorithm would otherwise make", () => {
      const actualRef = makeActual();
      const snapshot = makeSnapshot({ tradeId: actualRef.tradeId });
      const replay = makeReplay({ historicalTimestamp: "2026-08-04T14:01:00.000Z" }); // would otherwise be a strong HIGH match
      const links: ManualComparisonLink[] = [{ actualTradeId: actualRef.tradeId, replayTradeId: replay.id, linkType: "EXCLUDED" }];
      const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [replay], links);
      expect(result.matched).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(1);
      expect(result.unmatchedReplayTaken).toHaveLength(1);
    });

    it("ignores a stale manual link referencing a trade no longer present in the baseline/session", () => {
      const actualRef = makeActual();
      const snapshot = makeSnapshot({ tradeId: actualRef.tradeId });
      const links: ManualComparisonLink[] = [{ actualTradeId: "does-not-exist", replayTradeId: "also-missing", linkType: "MATCHED" }];
      const result = matchActualToReplayDecisions(enrichedBaseline([actualRef], [snapshot]), [], links);
      expect(result.matched).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(1);
    });
  });
});
