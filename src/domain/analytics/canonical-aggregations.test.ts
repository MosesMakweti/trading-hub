import { describe, expect, it } from "vitest";

import { buildCanonicalTradeRow, type CanonicalTradeRowInput } from "@/domain/analytics/canonical-dataset";
import {
  aggregateByAsset,
  aggregateByBehaviourLabel,
  aggregateByBiasAlignment,
  aggregateByDirection,
  aggregateByMonth,
  aggregateByMoodIntensity,
  aggregateByMoodTag,
  aggregateByOverrideReason,
  aggregateBySession,
  aggregateBySetupType,
  aggregateByStrategy,
  aggregateByValidationState,
  aggregateByWeekday,
  buildCumulativeRealizedRCurve,
  summarizePlannedVsActual,
  summarizePsychologyAdherence,
  toStrategyPerformanceSummary,
} from "@/domain/analytics/canonical-aggregations";

function closedTrade(overrides: Partial<CanonicalTradeRowInput> = {}) {
  return buildCanonicalTradeRow({
    tradeId: overrides.tradeId ?? "t",
    dateKey: "2026-03-04",
    direction: "LONG",
    assetSymbol: "XAUUSD",
    strategyId: "s1",
    strategyName: "Liquidity Reversal",
    session: null,
    reviewLifecycleStatus: "FULLY_CLOSED",
    validationState: null,
    overrideReason: null,
    setupTypeName: null,
    validationScore: null,
    dailyBiasSnapshot: null,
    plannedR: 2,
    actualRR: 1,
    actualEntry: 1900,
    actualStopLoss: 1890,
    actualExit: 1910,
    resolvedInitialStop: 1890,
    partials: [],
    settled: true,
    settledRealizedR: 1,
    settledPnl: 100,
    preTradeMoodTags: [],
    moodIntensity: null,
    behaviourLabels: [],
    adherencePercent: null,
    confluencePercent: null,
    executionPercent: null,
    tradeQualityPercent: null,
    psychologyPercent: null,
    ...overrides,
  });
}

describe("aggregateByWeekday", () => {
  it("always returns Monday-Friday, even with zero trades", () => {
    const stats = aggregateByWeekday([]);
    expect(stats.map((s) => s.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect(stats.every((s) => s.count === 0)).toBe(true);
  });

  it("groups trades by weekday and shows sample size alongside the stat", () => {
    const rows = [
      closedTrade({ tradeId: "a", dateKey: "2026-03-02", actualRR: 1, settledRealizedR: 1 }), // Monday
      closedTrade({ tradeId: "b", dateKey: "2026-03-02", actualRR: -1, settledRealizedR: -1 }), // Monday
      closedTrade({ tradeId: "c", dateKey: "2026-03-03", actualRR: 2, settledRealizedR: 2 }), // Tuesday
    ];
    const stats = aggregateByWeekday(rows);
    const monday = stats.find((s) => s.label === "Monday")!;
    const tuesday = stats.find((s) => s.label === "Tuesday")!;
    expect(monday.count).toBe(2);
    expect(monday.totalR).toBe(0);
    expect(tuesday.count).toBe(1);
    expect(tuesday.totalR).toBe(2);
  });
});

describe("aggregateByMonth", () => {
  it("groups by YYYY-MM and sorts chronologically", () => {
    const rows = [
      closedTrade({ tradeId: "a", dateKey: "2026-02-10" }),
      closedTrade({ tradeId: "b", dateKey: "2026-03-01" }),
    ];
    const stats = aggregateByMonth(rows);
    expect(stats.map((s) => s.key)).toEqual(["2026-02", "2026-03"]);
  });
});

describe("aggregateByStrategy / aggregateBySetupType (frozen snapshot)", () => {
  it("groups by the trade's frozen strategy/setup-type name, sorted by total R", () => {
    const rows = [
      closedTrade({ tradeId: "a", strategyName: "Strategy A", setupTypeName: "Type A", actualRR: 3, settledRealizedR: 3 }),
      closedTrade({ tradeId: "b", strategyName: "Strategy B", setupTypeName: null, actualRR: 1, settledRealizedR: 1 }),
    ];
    const byStrategy = aggregateByStrategy(rows);
    expect(byStrategy[0].label).toBe("Strategy A");
    expect(byStrategy[0].totalR).toBe(3);

    const bySetup = aggregateBySetupType(rows);
    expect(bySetup.find((s) => s.label === "Type A")?.totalR).toBe(3);
    expect(bySetup.find((s) => s.label === "No Setup Type")?.totalR).toBe(1);
  });
});

describe("aggregateByValidationState / aggregateByOverrideReason", () => {
  it("separates validated, overridden, not-validated, and no-setup-type trades", () => {
    const rows = [
      closedTrade({ tradeId: "a", validationState: "VALIDATED", actualRR: 2, settledRealizedR: 2 }),
      closedTrade({ tradeId: "b", validationState: "OVERRIDDEN", overrideReason: "FOMO", actualRR: -2, settledRealizedR: -2 }),
      closedTrade({ tradeId: "c", validationState: null }),
    ];
    const stats = aggregateByValidationState(rows);
    expect(stats.find((s) => s.label === "Validated")?.totalR).toBe(2);
    expect(stats.find((s) => s.label === "Overridden")?.totalR).toBe(-2);
    expect(stats.find((s) => s.label === "No Setup Type used")?.count).toBe(1);

    const overrideBreakdown = aggregateByOverrideReason(rows);
    expect(overrideBreakdown).toHaveLength(1);
    expect(overrideBreakdown[0].label).toBe("FOMO");
    expect(overrideBreakdown[0].totalR).toBe(-2);
  });
});

describe("aggregateByBiasAlignment", () => {
  it("separates aligned, conflicting, and neutral/no-analysis trades", () => {
    const rows = [
      closedTrade({ tradeId: "a", direction: "LONG", dailyBiasSnapshot: "LONG", actualRR: 1.5, settledRealizedR: 1.5 }),
      closedTrade({ tradeId: "b", direction: "LONG", dailyBiasSnapshot: "SHORT", actualRR: -1, settledRealizedR: -1 }),
      closedTrade({ tradeId: "c", dailyBiasSnapshot: null }),
    ];
    const stats = aggregateByBiasAlignment(rows);
    expect(stats.find((s) => s.label === "Aligned with daily bias")?.totalR).toBe(1.5);
    expect(stats.find((s) => s.label === "Conflicted with daily bias")?.totalR).toBe(-1);
    expect(stats.find((s) => s.label === "Neutral / no daily analysis")?.count).toBe(1);
  });
});

describe("aggregateByBehaviourLabel", () => {
  it("one trade with multiple labels contributes to each label's group, positive/negative kept distinct", () => {
    const rows = [
      closedTrade({
        tradeId: "a",
        actualRR: 2,
        settledRealizedR: 2,
        behaviourLabels: [
          { name: "Followed trading plan", polarity: "POSITIVE" },
          { name: "Patient execution", polarity: "POSITIVE" },
        ],
      }),
      closedTrade({
        tradeId: "b",
        actualRR: -1.5,
        settledRealizedR: -1.5,
        behaviourLabels: [{ name: "FOMO trade", polarity: "NEGATIVE" }],
      }),
    ];
    const stats = aggregateByBehaviourLabel(rows);
    const followed = stats.find((s) => s.label === "Followed trading plan")!;
    const patient = stats.find((s) => s.label === "Patient execution")!;
    const fomo = stats.find((s) => s.label === "FOMO trade")!;
    expect(followed.totalR).toBe(2);
    expect(followed.polarity).toBe("POSITIVE");
    expect(patient.totalR).toBe(2);
    expect(fomo.totalR).toBe(-1.5);
    expect(fomo.polarity).toBe("NEGATIVE");
  });
});

describe("aggregateByMoodTag / aggregateByMoodIntensity", () => {
  it("groups by mood tag (multi-tag flat-map) and by intensity 1-5", () => {
    const rows = [
      closedTrade({ tradeId: "a", actualRR: 1, settledRealizedR: 1, preTradeMoodTags: ["CALM", "FOCUSED"], moodIntensity: 2 }),
      closedTrade({ tradeId: "b", actualRR: -2, settledRealizedR: -2, preTradeMoodTags: ["FOMO"], moodIntensity: 5 }),
    ];
    const byTag = aggregateByMoodTag(rows);
    expect(byTag.find((s) => s.label === "CALM")?.totalR).toBe(1);
    expect(byTag.find((s) => s.label === "FOMO")?.totalR).toBe(-2);

    const byIntensity = aggregateByMoodIntensity(rows);
    expect(byIntensity).toHaveLength(5);
    expect(byIntensity.find((s) => s.label === "Intensity 2")?.totalR).toBe(1);
    expect(byIntensity.find((s) => s.label === "Intensity 5")?.totalR).toBe(-2);
    expect(byIntensity.find((s) => s.label === "Intensity 1")?.count).toBe(0);
  });
});

describe("buildCumulativeRealizedRCurve", () => {
  it("is chronological and cumulative, excluding cancelled ideas entirely", () => {
    const rows = [
      closedTrade({ tradeId: "b", dateKey: "2026-03-02", actualRR: 1, settledRealizedR: 1 }),
      closedTrade({ tradeId: "a", dateKey: "2026-03-01", actualRR: 2, settledRealizedR: 2 }),
      buildCanonicalTradeRow({
        tradeId: "c",
        dateKey: "2026-03-03",
        direction: "LONG",
        assetSymbol: "XAUUSD",
        strategyId: null,
        strategyName: null,
        session: null,
        reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED",
        validationState: null,
        overrideReason: null,
        setupTypeName: null,
        validationScore: null,
        dailyBiasSnapshot: null,
        plannedR: 2,
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
      }),
    ];
    const curve = buildCumulativeRealizedRCurve(rows);
    expect(curve.map((p) => p.tradeId)).toEqual(["a", "b"]); // chronological, "c" (cancelled) excluded
    expect(curve[0].cumulativeR).toBe(2);
    expect(curve[1].cumulativeR).toBe(3);
  });

  it("includes a partially-closed trade's realized-so-far R exactly once", () => {
    const partial = buildCanonicalTradeRow({
      tradeId: "p",
      dateKey: "2026-03-05",
      direction: "LONG",
      assetSymbol: "XAUUSD",
      strategyId: null,
      strategyName: null,
      session: null,
      reviewLifecycleStatus: "PARTIALLY_CLOSED",
      validationState: null,
      overrideReason: null,
      setupTypeName: null,
      validationScore: null,
      dailyBiasSnapshot: null,
      plannedR: null,
      actualRR: null,
      actualEntry: 1900,
      actualStopLoss: 1890,
      actualExit: null,
      resolvedInitialStop: 1890,
      partials: [{ exitPrice: 1910, percentClosed: 50 }],
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
    });
    const curve = buildCumulativeRealizedRCurve([partial]);
    expect(curve).toHaveLength(1);
    expect(curve[0].cumulativeR).toBeCloseTo(0.5, 4);
  });

  it("renders safely for an empty dataset", () => {
    expect(buildCumulativeRealizedRCurve([])).toEqual([]);
  });

  it("Audit Fixture B: +2R,-1R,+3R,-1R,0R produces a genuinely cumulative running sum, not isolated per-trade values", () => {
    const rows = [
      closedTrade({ tradeId: "1", dateKey: "2026-01-01", actualRR: 2, settledRealizedR: 2 }),
      closedTrade({ tradeId: "2", dateKey: "2026-01-02", actualRR: -1, settledRealizedR: -1 }),
      closedTrade({ tradeId: "3", dateKey: "2026-01-03", actualRR: 3, settledRealizedR: 3 }),
      closedTrade({ tradeId: "4", dateKey: "2026-01-04", actualRR: -1, settledRealizedR: -1 }),
      closedTrade({ tradeId: "5", dateKey: "2026-01-05", actualRR: 0, settledRealizedR: 0 }),
    ];
    const curve = buildCumulativeRealizedRCurve(rows);
    // Starting from an implicit 0 (the curve itself has no leading zero point —
    // that's the caller's starting-balance concern, see pnl-stats.test.ts's
    // Fixture C, which drives maxDrawdown() with the equivalent [0,2,1,4,3,3]).
    expect(curve.map((p) => p.cumulativeR)).toEqual([2, 1, 4, 3, 3]);
  });
});

describe("summarizePlannedVsActual", () => {
  it("computes the average planned-vs-realized gap and meet-or-exceed rate", () => {
    const rows = [
      closedTrade({ tradeId: "a", plannedR: 2, actualRR: 2, settledRealizedR: 2 }), // met
      closedTrade({ tradeId: "b", plannedR: 2, actualRR: -1, settledRealizedR: -1 }), // fell short (normal variance)
    ];
    const summary = summarizePlannedVsActual(rows);
    expect(summary.sampleSize).toBe(2);
    expect(summary.averagePlannedR).toBe(2);
    expect(summary.averageRealizedR).toBe(0.5);
    expect(summary.averageGap).toBeCloseTo(-1.5, 4);
    expect(summary.meetOrExceedRate).toBe(50);
  });

  it("renders safely with no qualifying trades", () => {
    const summary = summarizePlannedVsActual([]);
    expect(summary.sampleSize).toBe(0);
    expect(summary.averageGap).toBeNull();
  });

  it("a correctly-executed losing trade is normal variance, not penalized as a fake discrepancy", () => {
    // Plan called for 2R; the trade validly stopped out at -1R. This is not
    // an "expected minus actual" penalty — it's simply averaged in as data.
    const rows = [closedTrade({ tradeId: "a", plannedR: 2, actualRR: -1, settledRealizedR: -1 })];
    const summary = summarizePlannedVsActual(rows);
    expect(summary.averageRealizedR).toBe(-1);
    expect(summary.meetOrExceedRate).toBe(0); // honestly reported, not distorted
  });
});

describe("aggregateByAsset", () => {
  it("groups by asset symbol, sorted by total R", () => {
    const rows = [
      closedTrade({ tradeId: "a", assetSymbol: "XAUUSD", actualRR: 2, settledRealizedR: 2 }),
      closedTrade({ tradeId: "b", assetSymbol: "EURUSD", actualRR: -1, settledRealizedR: -1 }),
    ];
    const stats = aggregateByAsset(rows);
    expect(stats[0].label).toBe("XAUUSD");
    expect(stats[0].totalR).toBe(2);
    expect(stats.find((s) => s.label === "EURUSD")?.totalR).toBe(-1);
  });
});

describe("aggregateByDirection", () => {
  it("always returns both Long and Short, even with zero trades on one side", () => {
    const rows = [closedTrade({ tradeId: "a", direction: "LONG", actualRR: 1.5, settledRealizedR: 1.5 })];
    const stats = aggregateByDirection(rows);
    expect(stats.map((s) => s.label)).toEqual(["Long", "Short"]);
    expect(stats.find((s) => s.label === "Long")?.totalR).toBe(1.5);
    expect(stats.find((s) => s.label === "Short")?.count).toBe(0);
  });
});

describe("aggregateBySession", () => {
  it("groups by session, bucketing missing sessions as 'No session'", () => {
    const rows = [
      closedTrade({ tradeId: "a", session: "LONDON", actualRR: 1, settledRealizedR: 1 }),
      closedTrade({ tradeId: "b", session: null, actualRR: -1, settledRealizedR: -1 }),
    ];
    const stats = aggregateBySession(rows);
    expect(stats.find((s) => s.label === "LONDON")?.totalR).toBe(1);
    expect(stats.find((s) => s.label === "No session")?.totalR).toBe(-1);
  });
});

describe("toStrategyPerformanceSummary", () => {
  it("returns an empty-but-defined summary for no trades", () => {
    const summary = toStrategyPerformanceSummary([]);
    expect(summary).toMatchObject({
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: null,
      averageRR: null,
      totalRR: 0,
      profitFactor: null,
      expectancy: null,
      bestRR: null,
      worstRR: null,
      longestWinStreak: 0,
      longestLossStreak: 0,
      averagePsychologyPercent: null,
      averageAdherencePercent: null,
    });
  });

  it("computes real-R stats from FULLY_CLOSED rows and totalRR from every executed row (partial-aware)", () => {
    const rows = [
      closedTrade({ tradeId: "a", dateKey: "2026-03-02", actualRR: 2, settledRealizedR: 2, psychologyPercent: 80, adherencePercent: 90 }),
      closedTrade({ tradeId: "b", dateKey: "2026-03-03", actualRR: -1, settledRealizedR: -1, psychologyPercent: 40, adherencePercent: 60 }),
      buildCanonicalTradeRow({
        tradeId: "p",
        dateKey: "2026-03-04",
        direction: "LONG",
        assetSymbol: "XAUUSD",
        strategyId: "s1",
        strategyName: "Liquidity Reversal",
        session: null,
        reviewLifecycleStatus: "PARTIALLY_CLOSED",
        validationState: null,
        overrideReason: null,
        setupTypeName: null,
        validationScore: null,
        dailyBiasSnapshot: null,
        plannedR: null,
        actualRR: null,
        actualEntry: 1900,
        actualStopLoss: 1890,
        actualExit: null,
        resolvedInitialStop: 1890,
        partials: [{ exitPrice: 1910, percentClosed: 50 }],
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
      }),
    ];
    const summary = toStrategyPerformanceSummary(rows);
    expect(summary.totalTrades).toBe(3); // all 3 executed (partial included)
    expect(summary.winningTrades).toBe(1);
    expect(summary.losingTrades).toBe(1);
    expect(summary.winRate).toBe(50); // of the 2 FULLY_CLOSED trades
    expect(summary.totalRR).toBeCloseTo(2 - 1 + 0.5, 4); // realizedR sum, partial-aware
    expect(summary.bestRR).toBe(2);
    expect(summary.worstRR).toBe(-1);
    expect(summary.averagePsychologyPercent).toBe(60);
    expect(summary.averageAdherencePercent).toBe(75);
  });

  it("a cancelled idea contributes to neither totalTrades nor totalRR", () => {
    const cancelled = buildCanonicalTradeRow({
      tradeId: "c",
      dateKey: "2026-03-05",
      direction: "LONG",
      assetSymbol: "XAUUSD",
      strategyId: null,
      strategyName: null,
      session: null,
      reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED",
      validationState: null,
      overrideReason: null,
      setupTypeName: null,
      validationScore: null,
      dailyBiasSnapshot: null,
      plannedR: null,
      actualRR: null,
      actualEntry: 1900,
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
    });
    const summary = toStrategyPerformanceSummary([cancelled]);
    expect(summary.totalTrades).toBe(0);
    expect(summary.totalRR).toBe(0);
  });
});

describe("summarizePsychologyAdherence", () => {
  it("averages psychology and rule-adherence across executed rows only", () => {
    const rows = [
      closedTrade({ tradeId: "a", psychologyPercent: 80, executionPercent: 90 }),
      closedTrade({ tradeId: "b", psychologyPercent: 60, executionPercent: 70 }),
    ];
    const summary = summarizePsychologyAdherence(rows);
    expect(summary.averagePsychologyPercent).toBe(70);
    expect(summary.averageAdherencePercent).toBe(80);
    expect(summary.sampleSize).toBe(2);
  });

  it("is null-safe when nothing is recorded", () => {
    const summary = summarizePsychologyAdherence([]);
    expect(summary.averagePsychologyPercent).toBeNull();
    expect(summary.averageAdherencePercent).toBeNull();
    expect(summary.sampleSize).toBe(0);
  });

  it("excludes cancelled ideas from the average", () => {
    const cancelled = buildCanonicalTradeRow({
      tradeId: "c",
      dateKey: "2026-03-04",
      direction: "LONG",
      assetSymbol: "XAUUSD",
      strategyId: null,
      strategyName: null,
      session: null,
      reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED",
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
      executionPercent: 50,
      tradeQualityPercent: null,
      psychologyPercent: 20,
    });
    const summary = summarizePsychologyAdherence([cancelled]);
    expect(summary.sampleSize).toBe(0);
    expect(summary.averagePsychologyPercent).toBeNull();
  });
});
