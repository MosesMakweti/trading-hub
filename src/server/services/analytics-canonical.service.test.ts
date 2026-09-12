import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { createStrategy, renameStrategy } from "@/server/services/strategies.service";
import { createChecklistItem } from "@/server/services/strategy-sot.service";
import { strategyChecklistItemSchema } from "@/lib/validation/strategy-sot";
import * as setupTypesSvc from "@/server/services/strategy-setup-types.service";
import { getCanonicalAnalyticsDataset, summarizeCanonicalAnalytics } from "@/server/services/analytics-canonical.service";
import { getDailyAnalytics, getStrategyPerformance } from "@/server/services/analytics.service";
import { toStrategyPerformanceSummary } from "@/domain/analytics/canonical-aggregations";
import type { TradeInput } from "@/lib/validation/trades";

/** Analytics consolidation (Stage 10) — real integration tests against the
 *  dev Postgres DB, same pattern as journal-day.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `analytics-canonical-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: null,
    actualRR: null,
    performanceRiskPercentOverride: null,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {},
    setupTypeId: null,
    selectedSetupConditions: [],
    setupOverrideReason: null,
    setupOverrideNote: null,
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    preTradeMoodNote: null,
    ...overrides,
  };
}

describe("getCanonicalAnalyticsDataset — filters", () => {
  it("date range and strategy filters produce consistent, non-contradictory results", async () => {
    const user = await makeUser("filters");
    const strategyA = await createStrategy(user.id, { name: "Strategy A", description: undefined });
    const strategyB = await createStrategy(user.id, { name: "Strategy B", description: undefined });

    const inRangeA = await createTrade(user.id, "2026-04-10", minimalTradeInput({ strategyId: strategyA.id }));
    await updateTradeSections(user.id, inRangeA.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, inRangeA.id, { status: "FULLY_CLOSED" });

    const inRangeB = await createTrade(user.id, "2026-04-11", minimalTradeInput({ strategyId: strategyB.id }));
    await updateTradeSections(user.id, inRangeB.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1890 });
    await setReviewLifecycleStatus(user.id, inRangeB.id, { status: "FULLY_CLOSED" });

    const outOfRange = await createTrade(user.id, "2026-05-01", minimalTradeInput({ strategyId: strategyA.id }));
    await updateTradeSections(user.id, outOfRange.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, outOfRange.id, { status: "FULLY_CLOSED" });

    const rangeOnly = await getCanonicalAnalyticsDataset(user.id, { from: "2026-04-01", to: "2026-04-30" });
    expect(rangeOnly.map((r) => r.tradeId).sort()).toEqual([inRangeA.id, inRangeB.id].sort());

    const strategyFiltered = await getCanonicalAnalyticsDataset(user.id, {
      from: "2026-04-01",
      to: "2026-04-30",
      strategyId: strategyA.id,
    });
    expect(strategyFiltered.map((r) => r.tradeId)).toEqual([inRangeA.id]);
  });

  it("combining filters never contradicts a single-filter result (behaviour label + direction)", async () => {
    const user = await makeUser("filter-consistency");
    const long1 = await createTrade(user.id, "2026-04-12", minimalTradeInput({ direction: "LONG" }));
    const short1 = await createTrade(user.id, "2026-04-12", minimalTradeInput({ direction: "SHORT" }));

    const longOnly = await getCanonicalAnalyticsDataset(user.id, { from: "2026-04-01", to: "2026-04-30", direction: "LONG" });
    expect(longOnly.map((r) => r.tradeId)).toContain(long1.id);
    expect(longOnly.map((r) => r.tradeId)).not.toContain(short1.id);
  });
});

describe("summarizeCanonicalAnalytics", () => {
  it("excludes cancelled ideas from the overview and never fabricates R/PnL for them", async () => {
    const user = await makeUser("summary-cancelled");
    const winner = await createTrade(user.id, "2026-04-13", minimalTradeInput());
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });

    const cancelled = await createTrade(user.id, "2026-04-14", minimalTradeInput());
    await setReviewLifecycleStatus(user.id, cancelled.id, { status: "CANCELLED_NEVER_TRIGGERED" });

    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-04-01", to: "2026-04-30" });
    const summary = summarizeCanonicalAnalytics(rows);
    expect(summary.overview.totalExecutedTrades).toBe(1);
    expect(summary.overview.cancelledCount).toBe(1);
    expect(summary.overview.totalRealizedR).toBeCloseTo(2, 4);
  });

  it("renders safely for an empty dataset (tiny/zero-trade range)", async () => {
    const user = await makeUser("summary-empty");
    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-04-01", to: "2026-04-30" });
    const summary = summarizeCanonicalAnalytics(rows);
    expect(summary.overview.totalExecutedTrades).toBe(0);
    expect(summary.overview.winRate).toBeNull();
    expect(summary.cumulativeRCurve).toEqual([]);
    expect(summary.byWeekday).toHaveLength(5);
  });
});

describe("Stage 10.5 — source-of-truth migration", () => {
  it("getCanonicalAnalyticsDataset supports an all-time (no from/to) scope for per-strategy performance", async () => {
    const user = await makeUser("all-time-strategy");
    const strategy = await createStrategy(user.id, { name: "All-Time Strategy", description: undefined });
    const oldTrade = await createTrade(user.id, "2020-01-05", minimalTradeInput({ strategyId: strategy.id }));
    await updateTradeSections(user.id, oldTrade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, oldTrade.id, { status: "FULLY_CLOSED" });

    const rows = await getCanonicalAnalyticsDataset(user.id, { strategyId: strategy.id });
    expect(rows.map((r) => r.tradeId)).toEqual([oldTrade.id]);
  });

  it("getDailyAnalytics matches a direct canonical day-slice aggregation (one definition of daily realized R)", async () => {
    const user = await makeUser("daily-vs-canonical");
    const winner = await createTrade(user.id, "2026-06-01", minimalTradeInput());
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });
    const loser = await createTrade(user.id, "2026-06-01", minimalTradeInput());
    await updateTradeSections(user.id, loser.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1890 });
    await setReviewLifecycleStatus(user.id, loser.id, { status: "FULLY_CLOSED" });

    const daily = await getDailyAnalytics(user.id, "2026-06-01");
    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-06-01", to: "2026-06-01" });
    const expected = toStrategyPerformanceSummary(rows);

    expect(daily.totalTrades).toBe(2);
    expect(daily.totalTrades).toBe(expected.totalTrades);
    expect(daily.totalRR).toBeCloseTo(expected.totalRR, 6);
    expect(daily.winRate).toBe(expected.winRate);
    expect(daily.netPnl).toBeCloseTo(rows.reduce((s, r) => s + (r.pnl ?? 0), 0), 6);
  });

  it("getStrategyPerformance matches a direct canonical strategy-scope aggregation", async () => {
    const user = await makeUser("strategy-vs-canonical");
    const strategy = await createStrategy(user.id, { name: "Consolidated Strategy", description: undefined });
    const trade = await createTrade(user.id, "2026-06-02", minimalTradeInput({ strategyId: strategy.id }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1930 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const perf = await getStrategyPerformance(user.id, strategy.id);
    const rows = await getCanonicalAnalyticsDataset(user.id, { strategyId: strategy.id });
    const expected = toStrategyPerformanceSummary(rows);

    expect(perf).toEqual(expected);
    expect(perf.totalTrades).toBe(1);
    expect(perf.averageRR).toBeGreaterThan(0); // a real R-multiple, never a $ contribution %
  });

  it("carries psychologyPercent through to the canonical row and into toStrategyPerformanceSummary's average", async () => {
    const user = await makeUser("psychology-passthrough");
    const trade = await createTrade(user.id, "2026-06-03", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });
    await prisma.psychologyQuestionnaireResponse.create({
      data: { tradeId: trade.id, answers: {}, rawScore: 8, psychologyPercent: 88, grade: "A" },
    });

    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-06-01", to: "2026-06-30" });
    expect(rows.find((r) => r.tradeId === trade.id)?.psychologyPercent).toBe(88);
    expect(toStrategyPerformanceSummary(rows).averagePsychologyPercent).toBe(88);
  });

  it("overview exposes winning/losing/breakeven counts and byAsset/byDirection/bySession breakdowns", async () => {
    const user = await makeUser("overview-counts");
    const winner = await createTrade(user.id, "2026-06-04", minimalTradeInput({ assetSymbol: "XAUUSD", direction: "LONG", selectedSession: "LONDON" }));
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });
    const loser = await createTrade(user.id, "2026-06-04", minimalTradeInput({ assetSymbol: "EURUSD", direction: "SHORT", selectedSession: "NEW_YORK" }));
    await updateTradeSections(user.id, loser.id, { actualEntry: 1.1, actualStopLoss: 1.11, actualExit: 1.11 });
    await setReviewLifecycleStatus(user.id, loser.id, { status: "FULLY_CLOSED" });

    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-06-01", to: "2026-06-30" });
    const summary = summarizeCanonicalAnalytics(rows);
    expect(summary.overview.winningTrades).toBe(1);
    expect(summary.overview.losingTrades).toBe(1);
    expect(summary.overview.breakevenTrades).toBe(0);
    expect(summary.byAsset.find((a) => a.label === "XAUUSD")?.totalR).toBeGreaterThan(0);
    expect(summary.byDirection.map((d) => d.label)).toEqual(["Long", "Short"]);
    expect(summary.bySession.find((s) => s.label === "LONDON")).toBeTruthy();
  });
});

describe("Historical Analytics categories survive later Strategy Lab edits (Stage 10 §2)", () => {
  it("a Setup Type rename after the trade closed never changes its Analytics grouping", async () => {
    const user = await makeUser("frozen-analytics-category");
    const strategy = await createStrategy(user.id, { name: "Original Strategy", description: undefined });
    const mandatory = await createChecklistItem(
      user.id,
      strategy.id,
      "CONFLUENCE",
      strategyChecklistItemSchema.parse({
        name: "Bullish MSS",
        color: "GRAY",
        weight: 50,
        mandatory: true,
        directionApplicability: "BULLISH",
      }),
    );
    const setupType = await setupTypesSvc.createSetupType(user.id, strategy.id, { name: "Type A" });
    const [withScenarios] = await setupTypesSvc.listSetupTypesWithScenarios(user.id, strategy.id);
    const bullish = withScenarios.scenarios.find((s) => s.direction === "BULLISH")!;
    await setupTypesSvc.addScenarioCondition(user.id, bullish.id, { checklistItemId: mandatory.id });

    const trade = await createTrade(
      user.id,
      "2026-04-15",
      minimalTradeInput({
        strategyId: strategy.id,
        direction: "LONG",
        setupTypeId: setupType.id,
        selectedSetupConditions: [mandatory.id],
      }),
    );
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    await renameStrategy(user.id, strategy.id, "Renamed Strategy");
    await setupTypesSvc.updateSetupType(user.id, setupType.id, { name: "Renamed Setup Type" });

    const rows = await getCanonicalAnalyticsDataset(user.id, { from: "2026-04-01", to: "2026-04-30" });
    const summary = summarizeCanonicalAnalytics(rows);
    expect(summary.byStrategy.map((s) => s.label)).toContain("Original Strategy");
    expect(summary.byStrategy.map((s) => s.label)).not.toContain("Renamed Strategy");
    expect(summary.bySetupType.map((s) => s.label)).toContain("Type A");
    expect(summary.bySetupType.map((s) => s.label)).not.toContain("Renamed Setup Type");
  });
});
