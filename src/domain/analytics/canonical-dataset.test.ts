import { describe, expect, it } from "vitest";

import { buildCanonicalTradeRow, type CanonicalTradeRowInput } from "@/domain/analytics/canonical-dataset";

function baseInput(overrides: Partial<CanonicalTradeRowInput> = {}): CanonicalTradeRowInput {
  return {
    tradeId: "trade-1",
    dateKey: "2026-03-04", // a Wednesday
    direction: "LONG",
    assetSymbol: "XAUUSD",
    strategyId: "strategy-1",
    strategyName: "Liquidity Reversal",
    session: "LONDON",
    reviewLifecycleStatus: null,
    validationState: null,
    overrideReason: null,
    setupTypeName: null,
    validationScore: null,
    dailyBiasSnapshot: null,
    plannedR: null,
    actualRR: null,
    actualEntry: null,
    actualStopLoss: null,
    actualExit: null,
    resolvedInitialStop: null,
    partials: [],
    settled: false,
    settledRealizedR: null,
    settledPnl: null,
    preTradeMoodTags: [],
    moodIntensity: null,
    behaviourLabels: [],
    adherencePercent: null,
    confluencePercent: null,
    executionPercent: null,
    tradeQualityPercent: null,
    psychologyPercent: null,
    ...overrides,
  };
}

describe("buildCanonicalTradeRow", () => {
  it("derives weekday and monthKey from the dateKey", () => {
    const row = buildCanonicalTradeRow(baseInput({ dateKey: "2026-03-04" }));
    expect(row.weekday).toBe(3); // Wednesday
    expect(row.monthKey).toBe("2026-03");
  });

  it("a cancelled/never-triggered idea is excluded from executed-performance results", () => {
    const row = buildCanonicalTradeRow(
      baseInput({ reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED", actualEntry: 1900 }),
    );
    expect(row.isExecuted).toBe(false);
    expect(row.isCancelled).toBe(true);
    expect(row.realizedR).toBeNull();
    expect(row.finalizedR).toBeNull();
    expect(row.winLossClass).toBe("CANCELLED");
  });

  it("a fully closed winning trade classifies as WIN with a finalized R", () => {
    const row = buildCanonicalTradeRow(
      baseInput({
        reviewLifecycleStatus: "FULLY_CLOSED",
        actualEntry: 1900,
        actualStopLoss: 1890,
        actualExit: 1920,
        resolvedInitialStop: 1890,
        settled: true,
        settledRealizedR: 2,
        settledPnl: 200,
        actualRR: 2,
      }),
    );
    expect(row.winLossClass).toBe("WIN");
    expect(row.finalizedR).toBe(2);
    expect(row.realizedR).toBe(2);
    expect(row.pnl).toBe(200);
  });

  it("a fully closed losing trade classifies as LOSS — a correct execution, not a fabricated discrepancy", () => {
    const row = buildCanonicalTradeRow(
      baseInput({
        reviewLifecycleStatus: "FULLY_CLOSED",
        actualEntry: 1900,
        actualStopLoss: 1890,
        actualExit: 1890,
        resolvedInitialStop: 1890,
        settled: true,
        settledRealizedR: -1,
        settledPnl: -100,
        actualRR: -1,
      }),
    );
    expect(row.winLossClass).toBe("LOSS");
    expect(row.finalizedR).toBe(-1);
    // No separate "discrepancy" concept is fabricated here — this row is
    // simply a determined -1R loss, exactly as executed.
  });

  it("a breakeven fully-closed trade classifies as BREAKEVEN", () => {
    const row = buildCanonicalTradeRow(
      baseInput({
        reviewLifecycleStatus: "FULLY_CLOSED",
        actualEntry: 1900,
        settled: true,
        settledRealizedR: 0,
        settledPnl: 0,
        actualRR: 0,
      }),
    );
    expect(row.winLossClass).toBe("BREAKEVEN");
  });

  it("a partially closed trade only counts its legitimately realized-so-far R, never a final result", () => {
    const row = buildCanonicalTradeRow(
      baseInput({
        reviewLifecycleStatus: "PARTIALLY_CLOSED",
        actualEntry: 1900,
        actualStopLoss: 1890,
        resolvedInitialStop: 1890,
        partials: [{ exitPrice: 1910, percentClosed: 50 }],
        settled: false,
      }),
    );
    expect(row.isExecuted).toBe(true);
    expect(row.realizedR).toBeCloseTo(0.5, 4); // 50% * 1R, so far
    expect(row.finalizedR).toBeNull(); // not a determined result yet
    expect(row.winLossClass).toBe("PENDING");
    expect(row.pnl).toBeNull(); // never estimated for an open position
  });

  it("a still-holding trade with no exits yet has no realized R and stays PENDING", () => {
    const row = buildCanonicalTradeRow(
      baseInput({ reviewLifecycleStatus: "STILL_HOLDING", actualEntry: 1900, actualStopLoss: 1890 }),
    );
    expect(row.realizedR).toBeNull();
    expect(row.winLossClass).toBe("PENDING");
  });

  // Analytics V2 — settlePerformanceTrade and setReviewLifecycleStatus are
  // independent write paths; a trade can be genuinely Performance-settled
  // before the trader ever visits Trade Review to confirm reviewLifecycleStatus.
  // finalizedR must reflect the canonical settled fact, never wait on the
  // separate manual status.
  it("counts a genuinely settled trade as finalized even when reviewLifecycleStatus was never manually confirmed", () => {
    const row = buildCanonicalTradeRow(
      baseInput({
        reviewLifecycleStatus: null,
        actualEntry: 1900,
        actualStopLoss: 1890,
        actualExit: 1920,
        resolvedInitialStop: 1890,
        settled: true,
        settledRealizedR: 2,
        settledPnl: 200,
        actualRR: 2,
      }),
    );
    expect(row.finalizedR).toBe(2);
    expect(row.winLossClass).toBe("WIN");
  });

  it("still stays PENDING when settled is false, regardless of any stray reviewLifecycleStatus value", () => {
    const row = buildCanonicalTradeRow(
      baseInput({ reviewLifecycleStatus: "FULLY_CLOSED", actualEntry: 1900, actualStopLoss: 1890, settled: false }),
    );
    expect(row.finalizedR).toBeNull();
    expect(row.winLossClass).toBe("PENDING");
  });

  it("an idea with no actual entry yet is not executed and contributes nothing", () => {
    const row = buildCanonicalTradeRow(baseInput());
    expect(row.isExecuted).toBe(false);
    expect(row.realizedR).toBeNull();
  });

  it("carries psychologyPercent through unchanged (Stage 10.5 daily/strategy consolidation)", () => {
    const row = buildCanonicalTradeRow(baseInput({ psychologyPercent: 72 }));
    expect(row.psychologyPercent).toBe(72);
  });

  describe("daily bias alignment", () => {
    it("is ALIGNED when the daily bias matches the trade direction", () => {
      expect(buildCanonicalTradeRow(baseInput({ direction: "LONG", dailyBiasSnapshot: "LONG" })).biasAlignment).toBe(
        "ALIGNED",
      );
    });
    it("is CONFLICT when the daily bias opposes the trade direction", () => {
      expect(buildCanonicalTradeRow(baseInput({ direction: "LONG", dailyBiasSnapshot: "SHORT" })).biasAlignment).toBe(
        "CONFLICT",
      );
    });
    it("is NEUTRAL_OR_NONE when there's no analysis or it's neutral", () => {
      expect(buildCanonicalTradeRow(baseInput({ dailyBiasSnapshot: null })).biasAlignment).toBe("NEUTRAL_OR_NONE");
      expect(buildCanonicalTradeRow(baseInput({ dailyBiasSnapshot: "NEUTRAL" })).biasAlignment).toBe("NEUTRAL_OR_NONE");
    });
  });
});
