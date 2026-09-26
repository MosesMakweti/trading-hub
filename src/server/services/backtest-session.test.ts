import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/guards", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireUser } from "@/server/guards";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, getBacktestRunOverview, setBacktestRunStatus } from "@/server/services/backtest-run.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { createStrategy } from "@/server/services/strategies.service";
import { getOrCreatePerformanceAccount } from "@/server/services/accounts.service";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { runUnscoped } from "@/server/workspace/scope";
import { saveRoutineResponse, setRoutineReady } from "@/actions/today-routine.actions";
import { reopenDay, setDayAnalyzed, updateTodaysPlan } from "@/actions/today.actions";
import {
  addDirectionalEvidenceItem,
  createOrGetDailyAssetAnalysis,
  getDailyAssetAnalysisBias,
  updateDailyAssetAnalysis,
} from "@/actions/daily-asset-analysis.actions";
import { createTrade, updateTradeSection } from "@/actions/trades.actions";
import { setReviewLifecycleStatusAction, upsertPartialExitAction, listPartialExitsAction } from "@/actions/trade-review.actions";
import { createOpportunity, logMissedOutcome } from "@/actions/opportunity.actions";
import { closeTradingDayAction, loadDayCloseSummaryAction, saveDailyReflectionAction } from "@/actions/close-day.actions";
import type { RoutineSnapshot } from "@/domain/today/routine-snapshot";

/**
 * Backtesting Stages 3–4 — the shared Today workflow running inside a Backtest
 * Run, exercised through the REAL server actions (auth + revalidation mocked).
 * Proves: day-level actions honour the explicit runId (null = LIVE), record-
 * tied actions derive their environment from the record, the whole workflow
 * (pre-session → plan → idea → execution → review → day summary → close →
 * refinement → next day) works on a historical date, and nothing reaches
 * live data or live accounting.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => vi.mocked(revalidatePath).mockClear());

async function actAs(label: string) {
  const u = await createTestUser(`bt-session-${label}`);
  userIds.push(u.id);
  vi.mocked(requireUser).mockResolvedValue({ id: u.id, email: u.email, name: null } as Awaited<ReturnType<typeof requireUser>>);
  return u.id;
}

function newRun(userId: string, overrides: Record<string, unknown> = {}) {
  return createBacktestRun(
    userId,
    createBacktestRunSchema.parse({ name: "EURUSD V3", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31", ...overrides }),
  );
}

function tradeValues(strategyId = "") {
  return {
    strategyId,
    assetSymbol: "EURUSD",
    executionMinutes: 600,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 70,
    selectedSession: null,
    expectedRR: 2,
    actualRR: null,
    performanceClosingPnlGross: 0,
    performanceClosingPnlNet: 0,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no",
      riskManaged: "yes",
      followedExitPlan: "yes",
      alignedWithBias: "yes",
      influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no",
      outcomeWillInfluenceNext: "no",
      monitoringObsession: 10,
    },
  };
}

async function liveFootprint(userId: string) {
  const performance = await getOrCreatePerformanceAccount(userId);
  return {
    days: await prisma.tradingDay.count({ where: { userId } }),
    trades: await prisma.trade.count({ where: { userId } }),
    opportunities: await prisma.tradeOpportunity.count({ where: { userId } }),
    analyses: await prisma.dailyAssetAnalysis.count({ where: { userId } }),
    performanceAllocations: await prisma.tradeAccountAllocation.count({ where: { tradingAccountId: performance.id } }),
    snapshots: await prisma.performanceRiskSnapshot.count({ where: { userId } }),
  };
}

describe("day-level actions — the explicit runId decides the environment", () => {
  it("runId = run writes the simulated day; runId = null writes the live day", async () => {
    const userId = await actAs("dayref");
    const run = await newRun(userId);

    expect(await updateTodaysPlan({ dateKey: "2024-05-14", runId: run.id }, { maxTradesPerDay: 3 })).toEqual({ success: true });
    expect(await updateTodaysPlan({ dateKey: "2024-05-14", runId: null }, { maxTradesPerDay: 7 })).toEqual({ success: true });

    const simulated = await runInBacktestRun(userId, run.id, () => prisma.tradingDay.findFirst({ where: { userId } }));
    const live = await prisma.tradingDay.findFirst({ where: { userId } });
    expect(simulated?.maxTradesPerDay).toBe(3);
    expect(simulated?.backtestRunId).toBe(run.id);
    expect(live?.maxTradesPerDay).toBe(7);
    expect(live?.backtestRunId).toBeNull();
    // A backtest write refreshes the run's pages.
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/backtesting/${run.id}`, "layout");
  });

  it("rejects a day reference without an explicit runId, a foreign run, an out-of-range date, and writes to an archived run", async () => {
    const owner = await actAs("dayref-owner");
    const run = await newRun(owner);
    const intruder = await actAs("dayref-intruder");

    // Missing key → never silently LIVE.
    expect(await updateTodaysPlan({ dateKey: "2024-05-14" } as never, { maxTradesPerDay: 1 })).toEqual({
      success: false,
      error: "Invalid workspace day.",
    });
    const foreign = await updateTodaysPlan({ dateKey: "2024-05-14", runId: run.id }, { maxTradesPerDay: 1 });
    expect(foreign.success).toBe(false);
    expect(await runUnscoped("test", () => prisma.tradingDay.count({ where: { userId: intruder } }))).toBe(0);

    vi.mocked(requireUser).mockResolvedValue({ id: owner } as Awaited<ReturnType<typeof requireUser>>);
    const outOfRange = await updateTodaysPlan({ dateKey: "2024-07-01", runId: run.id }, { maxTradesPerDay: 1 });
    expect(outOfRange).toMatchObject({ success: false });
    expect((outOfRange as { error: string }).error).toMatch(/outside this run's period/);

    await setBacktestRunStatus(owner, run.id, "ARCHIVED");
    const archived = await updateTodaysPlan({ dateKey: "2024-05-14", runId: run.id }, { maxTradesPerDay: 1 });
    expect((archived as { error: string }).error).toMatch(/archived — reopen it/);
    // Reads stay allowed on an archived run.
    expect(await loadDayCloseSummaryAction({ dateKey: "2024-05-14", runId: run.id })).toMatchObject({ success: true });
  });
});

describe("record-tied actions — the record decides the environment", () => {
  it("edits a simulated trade with no client-side run id, and can't reach another user's trade", async () => {
    const userId = await actAs("record");
    const run = await newRun(userId);
    const created = await createTrade({ dateKey: "2024-05-14", runId: run.id }, tradeValues());
    expect(created.success).toBe(true);
    const tradeId = (created as { tradeId: string }).tradeId;

    expect(await updateTradeSection("2024-05-14", tradeId, { executionNotes: "from the replay" })).toEqual({ success: true });
    const reread = await runInBacktestRun(userId, run.id, () => prisma.trade.findFirst({ where: { id: tradeId } }));
    expect(reread?.executionNotes).toBe("from the replay");
    expect(await prisma.trade.count({ where: { userId } })).toBe(0); // nothing live

    await actAs("record-intruder");
    // Existing live behaviour for an unknown trade: the service throws "Trade not found."
    await expect(updateTradeSection("2024-05-14", tradeId, { executionNotes: "hijack" })).rejects.toThrow("Trade not found.");
    const after = await runInBacktestRun(userId, run.id, () => prisma.trade.findFirst({ where: { id: tradeId } }));
    expect(after?.executionNotes).toBe("from the replay");
  });
});

describe("full historical workflow through the shared actions", () => {
  it("pre-session → plan → idea → execution → review → day summary → close → refinement → next day, with zero live footprint", async () => {
    const userId = await actAs("workflow");
    const strategy = await createStrategy(userId, { name: "London Continuation", description: undefined });
    const run = await newRun(userId, { strategyId: strategy.id });
    const day = { dateKey: "2024-05-14", runId: run.id };
    const liveBefore = await liveFootprint(userId);

    // Opening the session: the shared loader, in the run's scope.
    let ws = await loadTradingWorkspace(userId, day.dateKey, { environment: "BACKTEST", runId: run.id });
    expect(ws.day.dateKey).toBe("2024-05-14");
    expect(ws.stepStatuses.find((s) => s.key === "preSession")?.status).toBe("current");

    // Pre-Session: answer every mandatory item from the user's own routine, then "ready".
    const snapshot = ws.routine.snapshot as RoutineSnapshot;
    for (const item of snapshot.sections.flatMap((s) => s.items).filter((i) => i.isMandatory)) {
      const res = await saveRoutineResponse(day, item.id, item.type === "CHECKBOX" ? { checked: true } : { text: "done" });
      expect(res).toEqual({ success: true });
    }
    expect(await setRoutineReady(day, true)).toEqual({ success: true });

    // Today's Plan: asset analysis + evidence + bias, then complete.
    const analysis = await createOrGetDailyAssetAnalysis(day, { assetSymbol: "EURUSD" });
    expect(analysis.success).toBe(true);
    const analysisId = (analysis as { id: string }).id;
    expect(await updateDailyAssetAnalysis("2024-05-14", analysisId, { finalBias: "LONG" })).toEqual({ success: true });
    expect((await addDirectionalEvidenceItem(day, { dailyAssetAnalysisId: analysisId, label: "HTF bullish", direction: "BULLISH" })).success).toBe(true);
    expect(await getDailyAssetAnalysisBias(day, "EURUSD")).toEqual({ finalBias: "LONG" });
    expect(await updateTodaysPlan(day, { planComplete: true })).toEqual({ success: true });

    // Trade Idea (inherits the day's bias snapshot) → Execution → Review.
    const created = await createTrade(day, tradeValues(strategy.id));
    const tradeId = (created as { tradeId: string }).tradeId;
    expect(await updateTradeSection("2024-05-14", tradeId, { actualEntry: 1.1, actualStopLoss: 1.095 })).toEqual({ success: true });
    expect(
      await upsertPartialExitAction("2024-05-14", tradeId, { exitOrder: 1, exitPrice: 1.11, percentClosed: 100, exitedAt: "2024-05-14T11:30" }),
    ).toMatchObject({ success: true });
    expect(await listPartialExitsAction(tradeId)).toHaveLength(1);
    expect(await setReviewLifecycleStatusAction("2024-05-14", tradeId, { status: "FULLY_CLOSED" })).toMatchObject({ success: true });

    const trade = await runInBacktestRun(userId, run.id, () => prisma.trade.findFirstOrThrow({ where: { id: tradeId } }));
    expect(trade.dailyBiasSnapshot).toBe("LONG");
    expect(trade.actualRR?.toNumber()).toBe(2); // price-derived: (1.11 − 1.10) / (1.10 − 1.095)

    // A missed setup the same day.
    const opp = await createOpportunity(day, {
      strategyId: strategy.id, assetSymbol: "EURUSD", direction: "SHORT", timeframe: null,
      selectedConfluences: [], selectedExecution: [], plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
    });
    expect(opp.success).toBe(true);
    const oppId = (opp as { opportunityId: string }).opportunityId;
    expect((await logMissedOutcome("2024-05-14", oppId, { missReason: "HESITATION", missNote: null, missedOutcome: "MISSED_WIN", missedRealizedR: 1.5 })).success).toBe(true);

    // Day Summary — real numbers under price-derived settlement.
    expect(await setDayAnalyzed(day, true)).toEqual({ success: true });
    const summary = await loadDayCloseSummaryAction(day);
    expect(summary).toMatchObject({ success: true });
    const data = (summary as { data: { wins: number; losses: number; totalRealizedRSoFar: number; missedValidOpportunityCount: number; settledCount: number; pendingCount: number } }).data;
    expect(data).toMatchObject({ wins: 1, losses: 0, missedValidOpportunityCount: 1, settledCount: 1, pendingCount: 0 });
    expect(data.totalRealizedRSoFar).toBeCloseTo(2);

    // Refinement → close the day.
    expect(await saveDailyReflectionAction(day, { dayCarryForward: "Wait for the London sweep", dayMainLesson: "Patience paid" })).toEqual({ success: true });
    expect(await closeTradingDayAction(day, {})).toEqual({ success: true });
    const overview = await getBacktestRunOverview(userId, run.id);
    expect(overview?.progress.completedTradingDays).toBe(1);
    expect(overview?.stats.executedTrades).toBe(1);

    // Next trading day carries the refinement forward — inside the run only.
    ws = await loadTradingWorkspace(userId, "2024-05-15", { environment: "BACKTEST", runId: run.id });
    expect(ws.carryForward).toEqual({ fromDateKey: "2024-05-14", carryForward: "Wait for the London sweep", mainLesson: "Patience paid", toImprove: null });
    const liveWs = await loadTradingWorkspace(userId, "2024-05-15", { environment: "LIVE" });
    expect(liveWs.carryForward).toBeNull();
    expect(liveWs.trades).toHaveLength(0);

    // Backtest analytics finalize by price; nothing reached live data or accounting.
    const rows = await runInBacktestRun(userId, run.id, () => getCanonicalAnalyticsDataset(userId, {}));
    expect(rows.map((r) => r.winLossClass)).toEqual(["WIN"]);
    expect(rows[0].finalizedR).toBeCloseTo(2);
    const liveAfter = await liveFootprint(userId);
    expect({ ...liveAfter, days: liveAfter.days - 1 }).toEqual(liveBefore); // the only live day is the one the live loader just opened
    expect(await prisma.tradeAccountAllocation.count({ where: { tradeId } })).toBe(0);
    expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId } })).toBe(0);

    // The closed simulated day can be reopened (still inside the run).
    expect(await reopenDay(day)).toEqual({ success: true });
  });
});

describe("shared loader", () => {
  it("LIVE loads only live rows; BACKTEST loads only the run's rows and refuses a foreign run", async () => {
    const userId = await actAs("loader");
    const runA = await newRun(userId, { name: "A" });
    const runB = await newRun(userId, { name: "B" });
    await createTrade({ dateKey: "2024-05-14", runId: runA.id }, tradeValues());
    await createTrade({ dateKey: "2024-05-14", runId: null }, tradeValues());

    const live = await loadTradingWorkspace(userId, "2024-05-14", { environment: "LIVE" });
    const a = await loadTradingWorkspace(userId, "2024-05-14", { environment: "BACKTEST", runId: runA.id });
    const b = await loadTradingWorkspace(userId, "2024-05-14", { environment: "BACKTEST", runId: runB.id });
    expect(live.trades).toHaveLength(1);
    expect(a.trades).toHaveLength(1);
    expect(b.trades).toHaveLength(0);
    expect(a.trades[0].id).not.toBe(live.trades[0].id);
    expect(a.day.id).not.toBe(live.day.id);
    // Live-only surfaces are empty in a backtest.
    expect(a.tradeFormAccounts).toEqual([]);
    expect(a.propFirmAccounts).toEqual([]);
    expect(a.reviewCommitments).toEqual({ weekly: [], monthly: [] });

    const stranger = await actAs("loader-stranger");
    await expect(loadTradingWorkspace(stranger, "2024-05-14", { environment: "BACKTEST", runId: runA.id })).rejects.toThrow("Backtest run not found.");
  });
});
