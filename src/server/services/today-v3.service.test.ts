import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import {
  createOrGetDailyAssetAnalysis,
  suggestDirectionalEvidenceFromStrategy,
  updateDailyAssetAnalysis,
} from "@/server/services/daily-asset-analysis.service";
import { saveDailyReflection } from "@/server/services/close-day.service";
import { getTodaysRules } from "@/server/services/today-rules.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { runLive } from "@/server/workspace/scope";

/**
 * Today V3 (Phase 1) — real integration tests against the test Postgres DB:
 * strategy evidence suggestions, Today's Rules sourcing, and the live
 * carry-forward's isolation from Backtesting days.
 */

async function makeStrategy(
  userId: string,
  name: string,
  opts: { maxDailyRiskPercent?: number; maxTradesPerDay?: number; sessions?: string[] } = {},
) {
  const strategy = await prisma.strategy.create({ data: { userId, name, applicableAssets: ["XAUUSD"] } });
  if (opts.maxDailyRiskPercent != null || opts.maxTradesPerDay != null) {
    await prisma.strategyTradeManagement.create({
      data: {
        strategyId: strategy.id,
        maxDailyRiskPercent: opts.maxDailyRiskPercent ?? null,
        maxTradesPerDay: opts.maxTradesPerDay ?? null,
      },
    });
  }
  for (const [i, s] of (opts.sessions ?? []).entries()) {
    await prisma.strategySession.create({ data: { userId, strategyId: strategy.id, name: s, sortOrder: i } });
  }
  return strategy;
}

describe("Today V3 — evidence suggestions from strategy", () => {
  const userIds: string[] = [];
  afterAll(() => deleteTestUsers(...userIds));

  it("inserts direction-specific confluences UNCHECKED, skips BOTH, and never duplicates", async () => {
    const user = await createTestUser("v3-evidence");
    userIds.push(user.id);
    const strategy = await makeStrategy(user.id, "London Sweep");
    await prisma.strategyChecklistItem.createMany({
      data: [
        { userId: user.id, strategyId: strategy.id, kind: "CONFLUENCE", name: "Sell-side sweep", directionApplicability: "BULLISH", sortOrder: 0 },
        { userId: user.id, strategyId: strategy.id, kind: "CONFLUENCE", name: "Bearish breaker", directionApplicability: "BEARISH", sortOrder: 1 },
        { userId: user.id, strategyId: strategy.id, kind: "CONFLUENCE", name: "FVG", directionApplicability: "BOTH", sortOrder: 2 },
        { userId: user.id, strategyId: strategy.id, kind: "CONFLUENCE", name: "Disabled one", directionApplicability: "BULLISH", enabled: false, sortOrder: 3 },
        { userId: user.id, strategyId: strategy.id, kind: "EXECUTION", name: "Entry trigger", directionApplicability: "BULLISH", sortOrder: 4 },
      ],
    });

    await runLive(async () => {
      const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-09-01", "XAUUSD");
      await expect(suggestDirectionalEvidenceFromStrategy(user.id, analysis.id)).rejects.toThrow(/active strategy/i);

      await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategy.id });
      // A trader's own free-text item with the same label must not be duplicated.
      await prisma.directionalEvidenceItem.create({
        data: { userId: user.id, dailyAssetAnalysisId: analysis.id, label: "sell-side sweep", direction: "BULLISH", sortOrder: 0 },
      });

      const first = await suggestDirectionalEvidenceFromStrategy(user.id, analysis.id);
      expect(first.created.map((c) => [c.label, c.direction, c.checked])).toEqual([["Bearish breaker", "BEARISH", false]]);
      expect(first.directionalSourceCount).toBe(2);

      expect(await suggestDirectionalEvidenceFromStrategy(user.id, analysis.id)).toEqual({ created: [], directionalSourceCount: 2 });

      const rows = await prisma.directionalEvidenceItem.findMany({ where: { dailyAssetAnalysisId: analysis.id }, orderBy: { sortOrder: "asc" } });
      expect(rows.map((r) => [r.label, r.checked])).toEqual([
        ["sell-side sweep", true],
        ["Bearish breaker", false],
      ]);
      // Suggesting never sets the human decision.
      const after = await prisma.dailyAssetAnalysis.findUniqueOrThrow({ where: { id: analysis.id } });
      expect(after.finalBias).toBeNull();
    });
  });
});

describe("Today V3 — Today's Rules source data", () => {
  const userIds: string[] = [];
  afterAll(() => deleteTestUsers(...userIds));

  it("loads each active strategy's limits, sessions and the Performance defaults without writing the day", async () => {
    const user = await createTestUser("v3-rules");
    userIds.push(user.id);
    const a = await makeStrategy(user.id, "A", { maxDailyRiskPercent: 2, maxTradesPerDay: 4, sessions: ["London"] });
    const b = await makeStrategy(user.id, "B", { maxDailyRiskPercent: 1.5, maxTradesPerDay: 2, sessions: ["New York"] });

    const rules = await getTodaysRules(user.id, [a.id, b.id, a.id]);
    expect(rules.strategies.map((s) => [s.name, s.maxDailyRiskPercent, s.maxTradesPerDay, s.sessions])).toEqual([
      ["A", 2, 4, ["London"]],
      ["B", 1.5, 2, ["New York"]],
    ]);
    expect(rules.performance.defaultRiskPercent).toBe(1);
    expect(await getTodaysRules(user.id, [])).toMatchObject({ strategies: [] });

    // Loading Today never stores a suggestion as a confirmed limit.
    const data = await loadTradingWorkspace(user.id, "2026-09-02", { environment: "LIVE" });
    expect(data.todaysPlan.riskBudgetPercent).toBeNull();
    expect(data.todaysPlan.maxTradesPerDay).toBeNull();
  });

  it("only loads strategies the user owns", async () => {
    const owner = await createTestUser("v3-rules-owner");
    const other = await createTestUser("v3-rules-other");
    userIds.push(owner.id, other.id);
    const foreign = await makeStrategy(other.id, "Foreign", { maxDailyRiskPercent: 0.5 });
    expect((await getTodaysRules(owner.id, [foreign.id])).strategies).toEqual([]);
  });
});

describe("Today V3 — live carry-forward never reads Backtesting days", () => {
  const userIds: string[] = [];
  afterAll(() => deleteTestUsers(...userIds));

  it("LIVE Today shows the previous LIVE day's reflection; a simulated day stays in its run", async () => {
    const user = await createTestUser("v3-carry");
    userIds.push(user.id);

    await runLive(() => saveDailyReflection(user.id, "2026-09-10", { dayCarryForward: "Wait for the 15m close", dayMainLesson: "Range was the trap" }));

    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "Leak check", assets: ["XAUUSD"], startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    // A LATER simulated day with its own reflection — must not reach LIVE.
    await runInBacktestRun(user.id, run.id, () =>
      saveDailyReflection(user.id, "2026-09-11", { dayCarryForward: "SIMULATED focus" }),
    );

    const live = await loadTradingWorkspace(user.id, "2026-09-12", { environment: "LIVE" });
    expect(live.carryForward).toEqual({
      fromDateKey: "2026-09-10",
      carryForward: "Wait for the 15m close",
      mainLesson: "Range was the trap",
      toImprove: null,
    });

    const simulated = await loadTradingWorkspace(user.id, "2026-09-12", { environment: "BACKTEST", runId: run.id });
    expect(simulated.carryForward?.carryForward).toBe("SIMULATED focus");
    expect(simulated.todaysRules).toBeNull();
  });

  it("a fresh live user has no carry-forward", async () => {
    const user = await createTestUser("v3-carry-empty");
    userIds.push(user.id);
    await runLive(() => getOrCreateTradingDay(user.id, "2026-09-01"));
    const live = await loadTradingWorkspace(user.id, "2026-09-02", { environment: "LIVE" });
    expect(live.carryForward).toBeNull();
  });
});

describe("Today V3 — a strategy with only direction-neutral confluences", () => {
  const userIds: string[] = [];
  afterAll(() => deleteTestUsers(...userIds));

  it("suggests nothing and reports zero directional sources", async () => {
    const user = await createTestUser("v3-evidence-neutral");
    userIds.push(user.id);
    const strategy = await makeStrategy(user.id, "Neutral only");
    await prisma.strategyChecklistItem.create({
      data: { userId: user.id, strategyId: strategy.id, kind: "CONFLUENCE", name: "FVG", directionApplicability: "BOTH" },
    });
    await runLive(async () => {
      const analysis = await createOrGetDailyAssetAnalysis(user.id, "2026-09-03", "EURUSD");
      await updateDailyAssetAnalysis(user.id, analysis.id, { activeStrategyId: strategy.id });
      expect(await suggestDirectionalEvidenceFromStrategy(user.id, analysis.id)).toEqual({ created: [], directionalSourceCount: 0 });
    });
  });
});
