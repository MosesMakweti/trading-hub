import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, listBacktestRunOverviews, runInBacktestRun, BacktestRunNotFoundError } from "@/server/services/backtest-run.service";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { createOpportunity, logMissedOutcome } from "@/server/services/opportunity.service";
import { createStrategy } from "@/server/services/strategies.service";
import { endDay } from "@/server/services/trading-day.service";
import { listClosedDayKeys, listDailyPerformanceSummaries } from "@/server/services/close-day.service";
import { loadJournalDay } from "@/server/services/journal-day-view.service";
import { getBacktestAnalytics } from "@/server/services/backtest-analytics.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { summarizePeriod } from "@/domain/journal/period-summary";
import { runLive, runUnscoped } from "@/server/workspace/scope";
import type { TradeInput } from "@/lib/validation/trades";

/**
 * Backtesting Journal + Analytics (Stages 5–6), real Postgres. One user with
 * a LIVE history, Run A and Run B on overlapping dates — every read must see
 * exactly its own dataset.
 */
const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

function tradeInput(direction: "LONG" | "SHORT" = "LONG"): TradeInput {
  return {
    strategyId: "", assetSymbol: "EURUSD", executionMinutes: 600, direction, higherTimeframeBias: direction === "LONG" ? "BULLISH" : "BEARISH",
    biasConfidencePercent: 70, selectedSession: null, expectedRR: 2, actualRR: null, performanceClosingPnlGross: 0, performanceClosingPnlNet: 0,
    psychPreTradeMindset: null, psychPostTradeReflection: null, psychLessonsLearned: null, psychWhatToWorkOn: null,
    allocations: [], propFirmExecutions: [], selectedConfluences: [], selectedExecution: [], selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no", riskManaged: "yes", followedExitPlan: "yes", alignedWithBias: "yes", influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no", outcomeWillInfluenceNext: "no", monitoringObsession: 10,
    },
  } as unknown as TradeInput;
}

/** A closed trade whose own prices produce exactly `r` (entry 1.1000, 1R = 50 pips). */
async function closedTrade(userId: string, dateKey: string, r: number) {
  const direction = r >= 0 ? "LONG" : "SHORT";
  const t = await createTrade(userId, dateKey, tradeInput(direction));
  const stop = direction === "LONG" ? 1.095 : 1.105;
  const exit = direction === "LONG" ? 1.1 + r * 0.005 : 1.1 - r * 0.005;
  await updateTradeSections(userId, t.id, { actualEntry: 1.1, actualStopLoss: stop, actualExit: Number(exit.toFixed(5)) });
  // The trader's Trade Review confirmation (what the Journal's W/L counts require).
  await setReviewLifecycleStatus(userId, t.id, { status: "FULLY_CLOSED" });
  return t;
}

let userId: string;
let runA: string;
let runB: string;
let strategyId: string;

beforeAll(async () => {
  const u = await createTestUser("bt-journal");
  userIds.push(u.id);
  userId = u.id;
  strategyId = (await createStrategy(userId, { name: "London V3", description: undefined })).id;
  const mk = (name: string) =>
    createBacktestRun(userId, createBacktestRunSchema.parse({ name, assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-06-28" }));
  runA = (await mk("Run A")).id;
  runB = (await mk("Run B")).id;
  const missed = async (dateKey: string) => {
    const opp = await createOpportunity(userId, dateKey, {
      strategyId, assetSymbol: "EURUSD", direction: "LONG", timeframe: null, selectedConfluences: [], selectedExecution: [],
      plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
    });
    await logMissedOutcome(userId, opp.id, { missReason: "HESITATION", missNote: null, missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null });
  };

  // LIVE: +2 on 14 May, one missed setup.
  await runLive(async () => {
    await closedTrade(userId, "2024-05-14", 2);
    await missed("2024-05-14");
  });
  // Run A: +2 (Mon 13), −1 (Tue 14), +1.5 (Mon 20); one missed on 14; 13 May closed.
  await runInBacktestRun(userId, runA, async () => {
    await closedTrade(userId, "2024-05-13", 2);
    await closedTrade(userId, "2024-05-14", -1);
    await closedTrade(userId, "2024-05-20", 1.5);
    await missed("2024-05-14");
    await endDay(userId, "2024-05-13");
  });
  // Run B: −1 on 14 May.
  await runInBacktestRun(userId, runB, () => closedTrade(userId, "2024-05-14", -1));
});

describe("Backtesting Journal", () => {
  it("each dataset's day summaries contain only its own trades, placed on simulated dates", async () => {
    const byKey = (d: { dateKey: string; totalRealizedR: number; missedCount: number; executedTradeCount: number }[]) =>
      Object.fromEntries(d.map((x) => [x.dateKey, [Number(x.totalRealizedR.toFixed(4)), x.executedTradeCount, x.missedCount]]));
    const a = await runInBacktestRun(userId, runA, () => listDailyPerformanceSummaries(userId));
    const b = await runInBacktestRun(userId, runB, () => listDailyPerformanceSummaries(userId));
    const live = await runLive(() => listDailyPerformanceSummaries(userId));

    expect(byKey(a)).toEqual({ "2024-05-13": [2, 1, 0], "2024-05-14": [-1, 1, 1], "2024-05-20": [1.5, 1, 0] });
    expect(byKey(b)).toEqual({ "2024-05-14": [-1, 1, 0] });
    expect(byKey(live)).toEqual({ "2024-05-14": [2, 1, 1] });
  });

  it("weekly, monthly and run totals are exact and scoped to the run", async () => {
    const a = await runInBacktestRun(userId, runA, () => listDailyPerformanceSummaries(userId));
    const week = new Set(["2024-05-13", "2024-05-14", "2024-05-15", "2024-05-16", "2024-05-17", "2024-05-18", "2024-05-19"]);
    expect(summarizePeriod(a, (k) => week.has(k))).toMatchObject({ trades: 2, totalR: 1, wins: 1, losses: 1, missed: 1 });
    expect(summarizePeriod(a, (k) => k.startsWith("2024-05"))).toMatchObject({ trades: 3, totalR: 2.5, wins: 2, losses: 1 });
    expect(summarizePeriod(a, (k) => k.startsWith("2024-06"))).toMatchObject({ trades: 0, totalR: 0 });
  });

  it("closed-day markers are per run", async () => {
    expect(await runInBacktestRun(userId, runA, () => listClosedDayKeys(userId))).toEqual(["2024-05-13"]);
    expect(await runInBacktestRun(userId, runB, () => listClosedDayKeys(userId))).toEqual([]);
  });

  it("a historical day loads only that run's workflow data, and viewing creates nothing", async () => {
    const before = await runUnscoped("test", () => prisma.tradingDay.count({ where: { userId } }));
    const dayA = await runInBacktestRun(userId, runA, () => loadJournalDay(userId, "2024-05-14", { historical: true }));
    const dayLive = await runLive(() => loadJournalDay(userId, "2024-05-14", { historical: true }));
    const empty = await runInBacktestRun(userId, runA, () => loadJournalDay(userId, "2024-05-22", { historical: true }));

    expect(dayA.trades.map((t) => t.actualRR)).toEqual([-1]);
    expect(dayA.opportunities).toHaveLength(1);
    expect(dayA.daySummary).toMatchObject({ losses: 1, missedValidOpportunityCount: 1 });
    expect(dayLive.trades.map((t) => t.actualRR)).toEqual([2]);
    expect(dayLive.trades[0].id).not.toBe(dayA.trades[0].id);
    expect(empty.trades).toEqual([]);
    expect(empty.recap).toBeNull();
    expect(await runUnscoped("test", () => prisma.tradingDay.count({ where: { userId } }))).toBe(before);
  });

  it("another user can't read the run's journal", async () => {
    const other = await createTestUser("bt-journal-other");
    userIds.push(other.id);
    await expect(runInBacktestRun(other.id, runA, () => listDailyPerformanceSummaries(other.id))).rejects.toBeInstanceOf(BacktestRunNotFoundError);
  });
});

describe("Backtesting Analytics", () => {
  it("computes exact run metrics, isolated from LIVE and the other run", async () => {
    const a = await getBacktestAnalytics(userId, runA);
    expect(a.overview).toMatchObject({ totalTrades: 3, finalizedTrades: 3, wins: 2, losses: 1 });
    expect(a.overview.netR).toBeCloseTo(2.5);
    expect(a.overview.winRate).toBeCloseTo(200 / 3);
    expect(a.overview.profitFactor).toBeCloseTo(3.5);
    expect(a.curve.map((p) => Number(p.cumulativeR.toFixed(4)))).toEqual([2, 1, 2.5]);
    expect(a.drawdown?.maxDrawdownR).toBeCloseTo(-1);
    expect(a.missed).toMatchObject({ missedOpportunities: 1, executedOpportunities: 0 });
    expect(Object.fromEntries(a.breakdowns.weekday.map((w) => [w.key, Number(w.totalR.toFixed(4))]))).toMatchObject({ "1": 3.5, "2": -1 });

    const b = await getBacktestAnalytics(userId, runB);
    expect(b.overview).toMatchObject({ totalTrades: 1, wins: 0, losses: 1 });
    expect(b.overview.netR).toBeCloseTo(-1);
    expect(b.missed.missedOpportunities).toBe(0);

    const live = await runLive(() => getCanonicalAnalyticsDataset(userId, {}));
    expect(live.map((r) => r.finalizedR)).toEqual([2]);
  });

  it("refuses another user's run", async () => {
    const other = await createTestUser("bt-analytics-other");
    userIds.push(other.id);
    await expect(getBacktestAnalytics(other.id, runA)).rejects.toBeInstanceOf(BacktestRunNotFoundError);
  });
});

describe("result finalisation — intentionally different mechanisms, same R", () => {
  it("an identical trade finalizes at +2R live (Performance Account settlement) and in a backtest (price-derived)", async () => {
    const u = await createTestUser("bt-settle");
    userIds.push(u.id);
    const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: "S", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    const live = await runLive(() => closedTrade(u.id, "2024-05-14", 2));
    const bt = await runInBacktestRun(u.id, run.id, () => closedTrade(u.id, "2024-05-14", 2));

    const liveRows = await runLive(() => getCanonicalAnalyticsDataset(u.id, {}));
    const btRows = await runInBacktestRun(u.id, run.id, () => getCanonicalAnalyticsDataset(u.id, {}));
    expect(liveRows[0].finalizedR).toBeCloseTo(2);
    expect(btRows[0].finalizedR).toBeCloseTo(2);

    const liveSnapshot = await prisma.performanceRiskSnapshot.findUnique({ where: { tradeId: live.id } });
    expect(liveSnapshot?.settledAt).not.toBeNull(); // live: settled by the Performance Account
    expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId: bt.id } })).toBe(0); // backtest: never
    const btTrade = await runInBacktestRun(u.id, run.id, () => prisma.trade.findFirstOrThrow({ where: { id: bt.id } }));
    expect(btTrade.actualRR?.toNumber()).toBe(2); // same one-way actualRR sync, price-derived
  });
});

describe("performance — a realistically large run", () => {
  it("1,000 trades: overview + journal + analytics load with batched queries (not per trade)", async () => {
    const u = await createTestUser("bt-perf");
    userIds.push(u.id);
    const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: "Big", assets: ["EURUSD"], startDate: "2023-01-02", endDate: "2024-12-31" }));
    const N = 1000;
    await runInBacktestRun(u.id, run.id, async () => {
      const base = Date.UTC(2023, 0, 2);
      await prisma.trade.createMany({
        data: Array.from({ length: N }, (_, i) => {
          const win = i % 5 < 3;
          return {
            userId: u.id,
            tradeDate: new Date(base + Math.floor(i / 2) * 86_400_000),
            executionMinutes: 600 + (i % 2) * 60,
            direction: "LONG" as const,
            higherTimeframeBias: "BULLISH" as const,
            biasConfidencePercent: 70,
            assetSymbol: i % 3 === 0 ? "GBPUSD" : "EURUSD",
            tradeNumber: i + 1,
            actualEntry: 1.1,
            actualStopLoss: 1.095,
            actualExit: win ? 1.11 : 1.095,
            reviewLifecycleStatus: "FULLY_CLOSED" as const,
            selectedSession: i % 2 ? "London" : "New York",
            timeframe: i % 2 ? "15m" : "5m",
          };
        }),
      });
    });

    const trade = prisma.trade as unknown as { findMany: (...a: unknown[]) => unknown };
    const spy = vi.spyOn(trade, "findMany");
    const t0 = performance.now();
    const analytics = await getBacktestAnalytics(u.id, run.id);
    const tAnalytics = performance.now() - t0;
    const findManyForAnalytics = spy.mock.calls.length;
    spy.mockClear();
    const t1 = performance.now();
    const days = await runInBacktestRun(u.id, run.id, () => listDailyPerformanceSummaries(u.id));
    const tJournal = performance.now() - t1;
    const findManyForJournal = spy.mock.calls.length;
    spy.mockRestore();

    const t2 = performance.now();
    const overviews = await listBacktestRunOverviews(u.id);
    const tOverview = performance.now() - t2;
    const payloadKb = Buffer.byteLength(JSON.stringify(analytics)) / 1024;

    expect(analytics.overview).toMatchObject({ totalTrades: N, finalizedTrades: N, wins: 600, losses: 400 });
    expect(analytics.overview.netR).toBeCloseTo(600 * 2 - 400);
    expect(overviews[0].stats).toMatchObject({ executedTrades: N, closedTrades: N, winRate: 60 });
    expect(overviews[0].stats.netR).toBeCloseTo(800);
    expect(days).toHaveLength(N / 2);
    expect(findManyForAnalytics).toBe(1); // one batched dataset query
    expect(findManyForJournal).toBe(1);
    if (process.env.PERF_LOG) {
      appendFileSync(
        process.env.PERF_LOG,
        `${N} trades — analytics ${tAnalytics.toFixed(0)}ms (payload ${payloadKb.toFixed(0)} KB), journal summaries ${tJournal.toFixed(0)}ms (${days.length} days), overview ${tOverview.toFixed(0)}ms\n`,
      );
    }
    expect(tAnalytics).toBeLessThan(5000);
    expect(tJournal).toBeLessThan(5000);
  });
});
