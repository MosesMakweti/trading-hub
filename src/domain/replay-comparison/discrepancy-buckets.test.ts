import { describe, expect, it } from "vitest";

import { buildDiscrepancyBuckets } from "@/domain/replay-comparison/discrepancy-buckets";
import type { MatchedDecisionPair, UnmatchedReplayEntry } from "@/domain/replay-comparison/types";
import type { ReplayTradeDTO } from "@/types/replay";

function makePair(overrides: Partial<MatchedDecisionPair> = {}): MatchedDecisionPair {
  return {
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    actual: {
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
      realizedR: 2,
      finalizedR: 2,
      pnl: 100,
    },
    replay: {
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
    } as ReplayTradeDTO,
    outcome: { actualR: 2, replayR: 2, deltaR: 0 },
    decision: {
      actualDirection: "LONG",
      replayDirection: "LONG",
      sameDirection: true,
      actualStrategyName: "Strategy A",
      replayStrategyName: "Strategy A",
      sameStrategy: true,
      actualSetupTypeName: "Breakout",
      replaySetupTypeName: "Breakout",
      sameSetupType: true,
      actualValidationState: "VALIDATED",
      replayValidationState: "VALIDATED",
      sameValidationState: true,
      actualDailyBiasSnapshot: null,
      replayDecisionType: "TAKEN",
    },
    validation: {
      comparable: false,
      incompatibilityReason: "test fixture",
      actualValidationState: "VALIDATED",
      replayValidationState: "VALIDATED",
      actualScore: null,
      replayScore: null,
      actualOverrideReason: null,
      replayOverrideReason: null,
      conditions: [],
      checkedOnlyInActual: [],
      checkedOnlyInReplay: [],
      mandatoryDifferenceNames: [],
    },
    execution: {
      actualReviewLifecycle: "FULLY_CLOSED",
      replayLifecycle: "CLOSED",
      actualHadPartials: false,
      replayHadPartials: false,
      samePartialManagementShape: true,
      comparable: true,
      entry: { actual: 1900, replay: 1900, signedDifference: 0, rDistance: 0, unitDistance: 0, unit: "POINT" },
      initialStop: { actual: 1890, replay: 1890, signedDifference: 0, rDistance: 0, unitDistance: 0, unit: "POINT" },
      actualPartialExits: [],
      replayPartialExits: [],
      actualFullExit: 1920,
      replayFullExit: 1920,
      actualRealizedR: 2,
      replayRealizedR: 2,
    },
    behaviour: {
      actualOverridden: false,
      replayOverridden: false,
      actualTookReplaySkipped: false,
      actualStopMovedOrWidened: false,
      replayStopMoved: false,
      actualManualOrEarlyExit: null,
      replayFollowedPlannedTargets: true,
      actualBehaviourLabels: [],
      actualMoodTags: [],
      actualMoodIntensity: null,
      actualTradeIntent: null,
    },
    classification: "SAME_DECISION",
    confidence: "HIGH",
    reason: "EXACT_CONTEXT_MATCH",
    source: "AUTO",
    actualSnapshot: null,
    ...overrides,
  };
}

describe("buildDiscrepancyBuckets", () => {
  it("a clean match (same decision, same execution, same outcome) lands in no bucket", () => {
    const result = buildDiscrepancyBuckets([makePair()], []);
    expect(result.strategyVariance.count).toBe(0);
    expect(result.executionDiscrepancy.count).toBe(0);
    expect(result.behavioralDiscrepancy.count).toBe(0);
  });

  it("same decision + same execution + different outcome is Strategy Variance, not Execution Discrepancy", () => {
    const pair = makePair({ outcome: { actualR: -1, replayR: 2, deltaR: 3 } });
    const result = buildDiscrepancyBuckets([pair], []);
    expect(result.strategyVariance.count).toBe(1);
    expect(result.executionDiscrepancy.count).toBe(0);
    expect(result.avoidableDiscrepancy.totalR).toBe(0); // never priced
  });

  it("a valid loss alone (same decision/execution) produces Strategy Variance only", () => {
    const pair = makePair({ outcome: { actualR: -1, replayR: -1, deltaR: 0 } });
    // Even with matching negative outcomes there's no delta, so no bucket at all —
    // confirms a valid loss alone (no divergence) creates zero discrepancy.
    const result = buildDiscrepancyBuckets([pair], []);
    expect(result.strategyVariance.count).toBe(0);
    expect(result.executionDiscrepancy.count).toBe(0);
    expect(result.behavioralDiscrepancy.count).toBe(0);
  });

  it("Actual override + Replay skip is Behavioral Discrepancy, never converted to R", () => {
    const pair = makePair({
      classification: "ACTUAL_TAKEN_REPLAY_SKIPPED",
      decision: { ...makePair().decision, replayDecisionType: "SKIPPED" },
      behaviour: { ...makePair().behaviour, actualOverridden: true, actualTookReplaySkipped: true },
      replay: { ...makePair().replay, decisionType: "SKIPPED" },
    });
    const result = buildDiscrepancyBuckets([pair], []);
    expect(result.behavioralDiscrepancy.count).toBe(1);
    expect(result.behavioralDiscrepancy.events[0].category).toBe("OVERRIDE_VS_SKIP");
  });

  it("a frozen negative behaviour label is evidenced as Behavioral Discrepancy", () => {
    const pair = makePair({ behaviour: { ...makePair().behaviour, actualBehaviourLabels: [{ name: "Revenge Trading", polarity: "NEGATIVE" }] } });
    const result = buildDiscrepancyBuckets([pair], []);
    expect(result.behavioralDiscrepancy.count).toBe(1);
    expect(result.behavioralDiscrepancy.events[0].category).toBe("BEHAVIOUR_LABEL_EVIDENCE");
  });

  it("computes Execution Discrepancy conservatively — entry degradation gets a defensible R-cost", () => {
    // Actual entry 1902 vs Replay 1900 (2pt worse), but stops both 10pts from
    // their own entry (1892/1890) so risk is unchanged — isolates the entry
    // signal from the stop-widening one.
    const pair = makePair({
      execution: {
        ...makePair().execution,
        entry: { actual: 1902, replay: 1900, signedDifference: -2, rDistance: -2 / 10, unitDistance: 2, unit: "POINT" },
        initialStop: { actual: 1892, replay: 1890, signedDifference: -2, rDistance: -0.2, unitDistance: 2, unit: "POINT" },
      },
    });
    const result = buildDiscrepancyBuckets([pair], []);
    expect(result.executionDiscrepancy.count).toBe(1);
    expect(result.executionDiscrepancy.events[0].category).toBe("ENTRY_DEGRADATION");
    expect(result.executionDiscrepancy.events[0].costR).toBeCloseTo(2 / 10, 4);
    expect(result.avoidableDiscrepancy.totalR).toBeCloseTo(2 / 10, 4);
  });

  it("stop widening is recorded structurally with costR null — never priced", () => {
    const pair = makePair({
      execution: {
        ...makePair().execution,
        entry: { actual: 1900, replay: 1900, signedDifference: 0, rDistance: 0, unitDistance: 0, unit: "POINT" },
        initialStop: { actual: 1880, replay: 1890, signedDifference: 10, rDistance: 0.5, unitDistance: 10, unit: "POINT" },
      },
    });
    const result = buildDiscrepancyBuckets([pair], []);
    const stopEvent = result.executionDiscrepancy.events.find((e) => e.category === "STOP_WIDENING");
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.costR).toBeNull();
    expect(result.avoidableDiscrepancy.totalR).toBe(0); // stop widening never contributes
  });

  it("partial-management shape difference is a count, not a priced event", () => {
    const pair = makePair({ execution: { ...makePair().execution, actualHadPartials: true, replayHadPartials: false, samePartialManagementShape: false } });
    const result = buildDiscrepancyBuckets([pair], []);
    const event = result.executionDiscrepancy.events.find((e) => e.category === "PARTIAL_NOT_FOLLOWED");
    expect(event).toBeDefined();
    expect(event!.costR).toBeNull();
  });

  it("only CONFIRMED missed opportunities enter Opportunity Discrepancy", () => {
    const base: UnmatchedReplayEntry = {
      dateKey: "2026-08-05",
      assetSymbol: "EURUSD",
      replay: {
        id: "rt-missed",
        historicalTimestamp: "2026-08-05T10:00:00.000Z",
        assetSymbol: "EURUSD",
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
        plannedEntry: 1.1,
        plannedStopLoss: 1.09,
        currentStopLoss: 1.09,
        simulatedEntry: 1.1,
        filledAt: "2026-08-05T10:00:00.000Z",
        simulatedExit: 1.12,
        closedAt: "2026-08-05T11:00:00.000Z",
        closeReason: "TARGET",
        remainingPercent: 0,
        realizedReplayR: 3,
        lastProcessedTime: "2026-08-05T11:00:00.000Z",
        pendingAmbiguity: null,
        notes: null,
        targets: [],
        partialExits: [],
        executionEvents: [],
      } as ReplayTradeDTO,
      classification: "ACTUAL_ABSENT_REPLAY_TAKEN",
      missedOpportunityStatus: "UNCONFIRMED",
      confirmedAt: null,
    };
    const unconfirmed = { ...base };
    const confirmed = { ...base, dateKey: "2026-08-06", missedOpportunityStatus: "CONFIRMED_MISSED" as const, confirmedAt: "2026-08-06T00:00:00.000Z" };
    const rejected = { ...base, dateKey: "2026-08-07", missedOpportunityStatus: "NOT_MISSED" as const };

    const result = buildDiscrepancyBuckets([], [unconfirmed, confirmed, rejected]);
    expect(result.opportunityDiscrepancy.count).toBe(1);
    expect(result.opportunityDiscrepancy.entries[0].replayTradeId).toBe("rt-missed");
    expect(result.opportunityDiscrepancy.totalReplayR).toBe(3);
  });
});
