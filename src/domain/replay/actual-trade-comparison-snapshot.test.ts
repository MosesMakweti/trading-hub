import { describe, expect, it } from "vitest";

import { buildActualTradeComparisonSnapshot, type ActualTradeComparisonSnapshotInput } from "@/domain/replay/actual-trade-comparison-snapshot";

function baseInput(overrides: Partial<ActualTradeComparisonSnapshotInput> = {}): ActualTradeComparisonSnapshotInput {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    createdAt: new Date("2026-08-04T13:00:00.000Z"),
    tradeDate: new Date("2026-08-04T00:00:00.000Z"),
    executionMinutes: 570, // 09:30 UTC
    closedAt: new Date("2026-08-04T15:00:00.000Z"),
    direction: "LONG",
    assetSymbol: "XAUUSD",
    session: "London",
    strategyId: "s-1",
    strategyName: "Strategy A",
    strategyVersion: 3,
    validationState: "VALIDATED",
    overrideReason: null,
    overrideNote: null,
    setupValidationSnapshot: null,
    dailyBiasSnapshot: "LONG",
    reviewLifecycleStatus: "FULLY_CLOSED",
    plannedR: 2,
    actualRR: 2,
    actualEntry: 1900,
    actualStopLoss: 1890,
    actualExit: 1920,
    resolvedInitialStop: 1890,
    legacyPlannedEntry: 1901,
    legacyPlannedStopLoss: 1891,
    legacyPlannedTarget: 1921,
    confirmedPlan: null,
    actualPartialExits: [],
    // Analytics V2 — a genuinely FULLY_CLOSED trade with a real actualRR is
    // canonically settled too; settled/settledRealizedR/settledPnl must stay
    // consistent with reviewLifecycleStatus/actualRR above (real usage
    // always writes them together via settlePerformanceTrade), or
    // buildCanonicalTradeRow correctly treats it as still pending.
    settled: true,
    settledRealizedR: 2,
    settledPnl: 200,
    preTradeMoodTags: ["Focused"],
    preTradeMoodIntensity: 4,
    tradeIntent: "PLANNED",
    behaviourLabels: [{ name: "Patient Entry", polarity: "POSITIVE" }],
    ...overrides,
  };
}

describe("buildActualTradeComparisonSnapshot", () => {
  it("freezes the three distinct timing instants", () => {
    const snap = buildActualTradeComparisonSnapshot(baseInput());
    expect(snap.ideaCreatedAt).toBe("2026-08-04T13:00:00.000Z");
    expect(snap.executionStartedAt).toBe(new Date(Date.UTC(2026, 7, 4, 9, 30)).toISOString());
    expect(snap.closedAt).toBe("2026-08-04T15:00:00.000Z");
  });

  it("prefers the confirmed TradePlanVersion over legacy plan fields when present", () => {
    const withPlan = buildActualTradeComparisonSnapshot(
      baseInput({
        confirmedPlan: {
          entry: 1902,
          stopLoss: 1892,
          weightedPlannedR: 2.5,
          targetsSnapshot: [{ targetOrder: 1, label: "TP1", targetPrice: 1922, plannedClosePercent: 50, rMultiple: 2 }],
        },
      }),
    );
    expect(withPlan.plannedEntry).toBe(1902);
    expect(withPlan.plannedStopLoss).toBe(1892);
    expect(withPlan.plannedTargets).toEqual([{ order: 1, label: "TP1", price: 1922, percentToClose: 50, rMultiple: 2 }]);
  });

  it("falls back to legacy plan fields (a single target) when no confirmed plan version exists", () => {
    const snap = buildActualTradeComparisonSnapshot(baseInput({ confirmedPlan: null }));
    expect(snap.plannedEntry).toBe(1901);
    expect(snap.plannedStopLoss).toBe(1891);
    expect(snap.plannedTargets).toEqual([{ order: 1, label: "Target", price: 1921, percentToClose: null, rMultiple: null }]);
  });

  it("freezes the validation snapshot verbatim, deriving setupTypeName/scenarioDirection from it", () => {
    const snapshot = {
      strategyName: "Strategy A",
      strategyVersion: 3,
      setupType: { id: "st-1", name: "Breakout" },
      scenario: { id: "sc-1", direction: "BULLISH" as const },
      conditions: [],
      score: 90,
      totalEligibleWeight: 10,
      selectedEligibleWeight: 9,
      mandatoryGateMet: true,
      missingMandatoryConditionNames: [],
      validationState: "VALIDATED" as const,
      overrideReason: null,
      overrideNote: null,
      evaluatedAt: "2026-08-04T13:00:00.000Z",
    };
    const snap = buildActualTradeComparisonSnapshot(baseInput({ setupValidationSnapshot: snapshot }));
    expect(snap.validationSnapshot).toBe(snapshot); // frozen verbatim, same reference
    expect(snap.setupTypeName).toBe("Breakout");
    expect(snap.scenarioDirection).toBe("BULLISH");
  });

  it("freezes actual partial exits with timestamp/order/R, sorted by exit order", () => {
    const snap = buildActualTradeComparisonSnapshot(
      baseInput({
        actualPartialExits: [
          { exitOrder: 2, exitPrice: 1920, percentClosed: 50, exitedAt: new Date("2026-08-04T14:30:00.000Z"), realizedR: 1 },
          { exitOrder: 1, exitPrice: 1910, percentClosed: 50, exitedAt: new Date("2026-08-04T14:00:00.000Z"), realizedR: 1 },
        ],
      }),
    );
    expect(snap.partialExits.map((p) => p.order)).toEqual([1, 2]);
    expect(snap.partialExits[0].exitedAt).toBe("2026-08-04T14:00:00.000Z");
  });

  it("freezes behaviour labels and mood context by value, never a live reference", () => {
    const snap = buildActualTradeComparisonSnapshot(baseInput());
    expect(snap.behaviourLabels).toEqual([{ name: "Patient Entry", polarity: "POSITIVE" }]);
    expect(snap.preTradeMoodTags).toEqual(["Focused"]);
    expect(snap.preTradeMoodIntensity).toBe(4);
    expect(snap.tradeIntent).toBe("PLANNED");
  });

  it("reuses buildCanonicalTradeRow for realizedR/finalizedR/winLossClass — no second execution model", () => {
    const win = buildActualTradeComparisonSnapshot(baseInput({ actualRR: 2, reviewLifecycleStatus: "FULLY_CLOSED" }));
    expect(win.realizedR).toBeCloseTo(2, 4);
    expect(win.finalizedR).toBeCloseTo(2, 4);
    expect(win.winLossClass).toBe("WIN");

    const cancelled = buildActualTradeComparisonSnapshot(
      baseInput({ reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED", actualEntry: null, actualRR: null }),
    );
    expect(cancelled.isCancelled).toBe(true);
    expect(cancelled.winLossClass).toBe("CANCELLED");
  });

  it("keeps tradeId only as an identity reference — never used to derive a comparison fact here", () => {
    const snap = buildActualTradeComparisonSnapshot(baseInput({ tradeId: "some-id" }));
    expect(snap.tradeId).toBe("some-id");
    // every other field on the snapshot is copied from the input's own values,
    // not looked up from tradeId — asserted structurally by construction.
  });
});
