import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { getOrCreateTradingDay, updateTodaysPlan } from "@/server/services/trading-day.service";
import { createOrGetDailyAssetAnalysis, updateDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { loadJournalDay } from "@/server/services/journal-day-view.service";
import { createQuickIdea, getDayLimitState } from "@/server/services/today-trade.service";
import { quickIdeaSchema } from "@/lib/validation/today-v3";
import { summarizeDayRules } from "@/domain/today/rule-suggestions";
import { defaultPhase, phaseAfterPlan } from "@/domain/today/day-phase";

/** Plan UX pass — the simplified Plan writes the same canonical data. */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function strategy(userId: string, name: string, risk: number | null, trades: number | null, sessions: string[] = []) {
  const s = await prisma.strategy.create({ data: { userId, name, applicableAssets: ["XAUUSD", "EURUSD"] } });
  await prisma.strategyTradeManagement.create({ data: { strategyId: s.id, maxDailyRiskPercent: risk, maxTradesPerDay: trades } });
  for (const [i, n] of sessions.entries()) await prisma.strategySession.create({ data: { userId, strategyId: s.id, name: n, sortOrder: i } });
  return s;
}

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("Plan UX — canonical data through the simplified Plan", () => {
  it("multiple assets inherit the strictest Strategy Lab limits; one Confirm writes the same day columns", async () => {
    const dateKey = "2026-09-21";
    const user = await createTestUser("plan-ux-limits");
    userIds.push(user.id);
    const london = await strategy(user.id, "London Sweep", 2, 3, ["London"]);
    const ny = await strategy(user.id, "NY Reversal", 1.5, 4, ["New York"]);

    const data = await runLive(async () => {
      for (const [symbol, strat, bias] of [["XAUUSD", london, "LONG"], ["EURUSD", ny, "SHORT"]] as const) {
        const a = await createOrGetDailyAssetAnalysis(user.id, dateKey, symbol);
        await updateDailyAssetAnalysis(user.id, a.id, { activeStrategyId: strat.id, finalBias: bias });
      }
      return loadTradingWorkspace(user.id, dateKey, { environment: "LIVE" });
    });
    expect(data.dailyAssetAnalyses.map((a) => [a.assetSymbol, a.finalBias])).toEqual(
      expect.arrayContaining([["XAUUSD", "LONG"], ["EURUSD", "SHORT"]]),
    );
    const sources = data.todaysRules!.strategies.map((s) => ({
      strategyId: s.id,
      strategyName: s.name,
      maxDailyRiskPercent: s.maxDailyRiskPercent,
      maxTradesPerDay: s.maxTradesPerDay,
    }));
    const summary = summarizeDayRules(
      sources,
      { riskBudgetPercent: data.todaysPlan.riskBudgetPercent, maxTradesPerDay: data.todaysPlan.maxTradesPerDay },
      { active: data.todaysPlan.activeSessions, strategySessions: data.todaysRules!.strategies.map((s) => s.sessions) },
    );
    expect(summary.confirmPatch).toEqual({ riskBudgetPercent: 1.5, maxTradesPerDay: 3, activeSessions: expect.arrayContaining(["London", "New York"]) });

    // The compact Confirm sends this patch through the same updateTodaysPlan.
    await runLive(() => updateTodaysPlan(user.id, dateKey, summary.confirmPatch!));
    const after = await runLive(() => loadTradingWorkspace(user.id, dateKey, { environment: "LIVE" }));
    expect(after.todaysPlan).toMatchObject({ riskBudgetPercent: 1.5, maxTradesPerDay: 3 });
    expect(after.todaysPlan.activeSessions.sort()).toEqual(["London", "New York"]);
    expect((await runLive(() => getDayLimitState(user.id, dateKey))).limits).toEqual({ riskLimitPercent: 1.5, maxTrades: 3 });
    // Strategy Lab itself is untouched (inherited, never rewritten).
    const tm = await prisma.strategyTradeManagement.findMany({ where: { strategyId: { in: [london.id, ny.id] } }, orderBy: { maxDailyRiskPercent: "asc" } });
    expect(tm.map((t) => [Number(t.maxDailyRiskPercent), t.maxTradesPerDay])).toEqual([[1.5, 4], [2, 3]]);
  });

  it("Day Context saves the same columns the Journal and Trade read; Plan → Trade transition", async () => {
    const dateKey = "2026-09-22";
    const user = await createTestUser("plan-ux-context");
    userIds.push(user.id);
    const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
    await prisma.routineItem.create({ data: { userId: user.id, sectionId: section.id, label: "x", type: "CHECKBOX", isMandatory: false, sortOrder: 0 } });

    await runLive(async () => {
      await updateTodaysPlan(user.id, dateKey, {
        lookingFor: doc("Sweep of Asia low into NY"),
        stayOutConditions: doc("No structure by London close"),
        importantConditions: doc("CPI at 14:30"),
        newsAcknowledged: true,
      });
      // Before readiness: Plan set continues to Prepare, and trading stays gated.
      expect(phaseAfterPlan(false)).toBe("prepare");
      await updateTodaysPlan(user.id, dateKey, { planComplete: true });
      await expect(createQuickIdea(user.id, dateKey, quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 600 }))).rejects.toThrow(/ready/i);
      const day = await getOrCreateTradingDay(user.id, dateKey);
      await getOrCreateDayRoutine(user.id, day);
      await setRoutineReady(user.id, dateKey, true);
    });

    const ws = await loadTradingWorkspace(user.id, dateKey, { environment: "LIVE" });
    expect(ws.todaysPlan.planComplete).toBe(true);
    expect(JSON.stringify(ws.todaysPlan.lookingFor)).toContain("Sweep of Asia low");
    expect(JSON.stringify(ws.todaysPlan.stayOutConditions)).toContain("No structure");
    expect(defaultPhase({ archived: false, ready: true, planSet: true, tradeCount: 0 })).toBe("trade");
    expect(phaseAfterPlan(true)).toBe("trade");
    await runLive(() => createQuickIdea(user.id, dateKey, quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 600 })));

    const journal = await runLive(() => loadJournalDay(user.id, dateKey, { historical: true }));
    expect(JSON.stringify(journal.plan?.lookingFor)).toContain("Sweep of Asia low");
    expect(JSON.stringify(journal.plan?.importantConditions)).toContain("CPI");
    expect(journal.plan?.newsAcknowledged).toBe(true);
    expect(journal.trades).toHaveLength(1);
  });
});
