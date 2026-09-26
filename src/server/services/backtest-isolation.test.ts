import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createTrade, listTradesForDay, updateTradeSections } from "@/server/services/trades.service";
import { getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { listDailyPerformanceSummaries } from "@/server/services/close-day.service";
import { getOrCreatePerformanceAccount } from "@/server/services/accounts.service";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import { upsertExecution } from "@/server/services/trade-executions.service";
import { settlePerformanceTrade } from "@/server/services/performance-account.service";
import { createOpportunity, linkExecutedTrade } from "@/server/services/opportunity.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { createStrategy, renameStrategy } from "@/server/services/strategies.service";
import {
  BacktestRunNotFoundError,
  createBacktestRun,
  runInBacktestRun,
  touchBacktestRunSession,
  BacktestDateOutOfRangeError,
} from "@/server/services/backtest-run.service";
import { backtestScope, runInWorkspaceScope, runUnscoped } from "@/server/workspace/scope";
import { WorkspaceScopeViolationError } from "@/server/workspace/prisma-scope";
import type { TradeInput } from "@/lib/validation/trades";

/**
 * Backtesting Environment — Stage 1 isolation boundary tests (real Postgres,
 * trading_hub_test). These pin the non-negotiable guarantees: simulated data
 * never reaches live reads or live accounting, runs never see each other, and
 * the historical simulation date is what gets stored.
 */

function tradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
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
    ...overrides,
  } as TradeInput;
}

const SIM_DATE = "2024-05-14";

function newRun(userId: string, name: string, overrides: Partial<Parameters<typeof createBacktestRun>[1]> = {}) {
  return createBacktestRun(userId, {
    name,
    assets: ["EURUSD"],
    startDate: "2024-01-01",
    endDate: "2024-06-30",
    tradingWeekdays: [1, 2, 3, 4, 5],
    ...overrides,
  });
}

async function opportunityInput(userId: string) {
  const strategy = await createStrategy(userId, { name: `Opp strategy ${Math.random().toString(36).slice(2)}`, description: undefined });
  return {
    strategyId: strategy.id,
    assetSymbol: "EURUSD",
    direction: "LONG",
    timeframe: null,
    selectedConfluences: [],
    selectedExecution: [],
    plannedEntry: null,
    plannedStopLoss: null,
    plannedTarget: null,
    plannedRR: null,
  } as Parameters<typeof createOpportunity>[2];
}

/** Creates and fully executes a winning trade (+2R) on `dateKey` in the
 *  CURRENT scope: entry 1.1000, stop 1.0950, exit 1.1100. */
async function executedWinner(userId: string, dateKey: string) {
  const trade = await createTrade(userId, dateKey, tradeInput());
  await updateTradeSections(userId, trade.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.11 });
  return trade;
}

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`backtest-${label}`);
  userIds.push(u.id);
  return u.id;
}

describe("Isolation — backtest data never reaches live reads", () => {
  let userId: string;
  let runId: string;
  let backtestTradeId: string;
  let liveTradeId: string;

  beforeAll(async () => {
    userId = await user("live-reads");
    runId = (await newRun(userId, "EURUSD Strategy V3")).id;
    liveTradeId = (await executedWinner(userId, SIM_DATE)).id;
    backtestTradeId = (await runInBacktestRun(userId, runId, () => executedWinner(userId, SIM_DATE))).id;
  });

  it("a backtest trade does NOT appear in the live Journal day list", async () => {
    const liveDay = await listTradesForDay(userId, SIM_DATE);
    expect(liveDay.map((t) => t.id)).toEqual([liveTradeId]);
  });

  it("a backtest trade does NOT appear in the live Journal calendar aggregation", async () => {
    const summaries = await listDailyPerformanceSummaries(userId);
    const day = summaries.find((s) => s.dateKey === SIM_DATE);
    expect(day?.executedTradeCount).toBe(1);
  });

  it("a backtest trade does NOT appear in live canonical Analytics", async () => {
    const rows = await getCanonicalAnalyticsDataset(userId, {});
    expect(rows.map((r) => r.tradeId)).toEqual([liveTradeId]);
  });

  it("a live trade does NOT appear in the backtest-scoped dataset", async () => {
    const rows = await runInBacktestRun(userId, runId, () => getCanonicalAnalyticsDataset(userId, {}));
    expect(rows.map((r) => r.tradeId)).toEqual([backtestTradeId]);
    const day = await runInBacktestRun(userId, runId, () => listTradesForDay(userId, SIM_DATE));
    expect(day.map((t) => t.id)).toEqual([backtestTradeId]);
  });

  it("a backtest trade id is invisible to id-targeted live reads and writes (fails closed)", async () => {
    expect(await prisma.trade.findFirst({ where: { id: backtestTradeId, userId } })).toBeNull();
    expect(await prisma.trade.findUnique({ where: { id: backtestTradeId } })).toBeNull();
    await expect(prisma.trade.update({ where: { id: backtestTradeId }, data: { executionNotes: "x" } })).rejects.toThrow();
    const { count } = await prisma.trade.updateMany({ where: { userId }, data: { executionNotes: "live-only" } });
    expect(count).toBe(1);
  });

  it("child rows of a backtest trade are hidden from user-wide live reads", async () => {
    await runInBacktestRun(userId, runId, async () => {
      await upsertPartialExit(userId, backtestTradeId, { exitOrder: 1, exitPrice: 1.105, percentClosed: 50, exitedAt: new Date("2024-05-14T11:00:00Z") });
    });
    const livePartials = await prisma.tradeActualPartialExit.findMany({ where: { userId } });
    expect(livePartials).toHaveLength(0);
    const scoped = await runInBacktestRun(userId, runId, () => prisma.tradeActualPartialExit.findMany({ where: { userId } }));
    expect(scoped).toHaveLength(1);
  });
});

describe("Isolation — backtest trades never touch live accounting", () => {
  let userId: string;
  let runId: string;

  beforeAll(async () => {
    userId = await user("accounting");
    runId = (await newRun(userId, "Accounting run")).id;
  });

  it("does NOT create a Performance Account allocation or risk snapshot, even when fully executed", async () => {
    const performance = await getOrCreatePerformanceAccount(userId);
    const allocationsBefore = await prisma.tradeAccountAllocation.count({ where: { tradingAccountId: performance.id } });

    const trade = await runInBacktestRun(userId, runId, () => executedWinner(userId, SIM_DATE));
    const settlement = await runInBacktestRun(userId, runId, () => settlePerformanceTrade(userId, trade.id));

    expect(settlement.status).toBe("NOT_CALCULABLE");
    expect(await prisma.tradeAccountAllocation.count({ where: { tradeId: trade.id } })).toBe(0);
    expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId: trade.id } })).toBe(0);
    expect(await prisma.tradeAccountAllocation.count({ where: { tradingAccountId: performance.id } })).toBe(allocationsBefore);
  });

  it("a live trade still gets its Performance Account allocation (live semantics unchanged)", async () => {
    const trade = await executedWinner(userId, "2026-01-05");
    expect(await prisma.tradeAccountAllocation.count({ where: { tradeId: trade.id } })).toBe(1);
    expect(await prisma.performanceRiskSnapshot.count({ where: { tradeId: trade.id } })).toBe(1);
  });

  it("does NOT modify Prop Firm account data — execution is refused", async () => {
    const firm = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Iso Firm", marketCategory: "CFD" });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Iso Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });
    const ledgerBefore = await prisma.accountLedgerEntry.count({ where: { accountId: account.id } });

    const trade = await runInBacktestRun(userId, runId, () => createTrade(userId, "2024-05-15", tradeInput()));
    await expect(
      runInBacktestRun(userId, runId, () =>
        upsertExecution(userId, trade.id, {
          propFirmAccountId: account.id,
          riskEntryMode: "PERCENT",
          riskBasis: "CURRENT_BALANCE",
          riskInputValue: 1,
          grossPnl: 500,
          status: "CLOSED",
        }),
      ),
    ).rejects.toThrow(/Prop Firm/);

    expect(await prisma.tradeAccountExecution.count({ where: { tradeId: trade.id } })).toBe(0);
    expect(await prisma.accountLedgerEntry.count({ where: { accountId: account.id } })).toBe(ledgerBefore);
  });

  it("refuses account allocations passed on a backtest trade idea", async () => {
    const performance = await getOrCreatePerformanceAccount(userId);
    await expect(
      runInBacktestRun(userId, runId, () =>
        createTrade(
          userId,
          SIM_DATE,
          tradeInput({ allocations: [{ tradingAccountId: performance.id, riskInputType: "PERCENT", riskValue: 1, closingPnlGross: 0, closingPnlNet: 0 }] }),
        ),
      ),
    ).rejects.toThrow(/allocated/);
  });
});

describe("Database backstop — triggers enforce isolation even if app code is bypassed", () => {
  let userId: string;
  let runId: string;
  let backtestTradeId: string;
  let liveTradeId: string;

  beforeAll(async () => {
    userId = await user("triggers");
    runId = (await newRun(userId, "Trigger run")).id;
    backtestTradeId = (await runInBacktestRun(userId, runId, () => createTrade(userId, SIM_DATE, tradeInput()))).id;
    liveTradeId = (await createTrade(userId, "2026-01-06", tradeInput())).id;
  });

  it("a backtest trade can never be relabelled live (and vice versa)", async () => {
    await expect(
      runUnscoped("test", () => prisma.trade.update({ where: { id: backtestTradeId }, data: { backtestRunId: null } })),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
    await expect(
      runUnscoped("test", () => prisma.trade.update({ where: { id: liveTradeId }, data: { backtestRunId: runId } })),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });

  it("rejects a Performance Account allocation row for a backtest trade", async () => {
    const performance = await getOrCreatePerformanceAccount(userId);
    await expect(
      prisma.tradeAccountAllocation.create({
        data: { tradeId: backtestTradeId, tradingAccountId: performance.id, riskInputType: "PERCENT", riskValue: 1 },
      }),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });

  it("rejects a simulated row whose user doesn't own the run", async () => {
    const otherUserId = await user("triggers-other");
    await expect(
      runUnscoped("test", () =>
        prisma.tradingDay.create({ data: { userId: otherUserId, date: new Date("2024-05-14"), backtestRunId: runId } }),
      ),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });

  it("rejects linking a backtest trade to a live opportunity", async () => {
    const liveOpportunity = await createOpportunity(userId, "2026-01-06", await opportunityInput(userId));
    await expect(
      runUnscoped("test", () =>
        prisma.trade.update({ where: { id: backtestTradeId }, data: { opportunityId: liveOpportunity.id } }),
      ),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });
});

describe("Workspace-scope extension semantics", () => {
  let userId: string;
  let runId: string;

  beforeAll(async () => {
    userId = await user("extension");
    runId = (await newRun(userId, "Extension run")).id;
  });

  it("refuses to create a LIVE root row from inside a BACKTEST scope", async () => {
    await expect(
      runInWorkspaceScope(backtestScope(runId), () =>
        prisma.tradingDay.create({ data: { userId, date: new Date("2024-05-20"), backtestRunId: null } }),
      ),
    ).rejects.toBeInstanceOf(WorkspaceScopeViolationError);
  });

  it("scope propagates through Promise.all, returned promises and interactive transactions", async () => {
    await runInBacktestRun(userId, runId, async () => {
      await getOrCreateTradingDay(userId, "2024-05-21");
    });
    const [a, b] = await runInBacktestRun(userId, runId, () =>
      Promise.all([getTradingDay(userId, "2024-05-21"), prisma.tradingDay.count({ where: { userId } })]),
    );
    expect(a?.backtestRunId).toBe(runId);
    expect(b).toBe(1);
    const inTx = await runInBacktestRun(userId, runId, () =>
      prisma.$transaction(async (tx) => tx.tradingDay.findMany({ where: { userId } })),
    );
    expect(inTx.map((d) => d.backtestRunId)).toEqual([runId]);
    expect(await getTradingDay(userId, "2024-05-21")).toBeNull(); // not live
  });

  it("entering a run owned by another user is refused", async () => {
    const intruder = await user("extension-intruder");
    await expect(runInBacktestRun(intruder, runId, async () => null)).rejects.toBeInstanceOf(BacktestRunNotFoundError);
  });
});

describe("Historical context — the simulation date is the effective date", () => {
  let userId: string;
  let runId: string;

  beforeAll(async () => {
    userId = await user("history");
    runId = (await newRun(userId, "History run")).id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selecting 2024-05-14 creates the day and trade for 2024-05-14, alongside an independent live day", async () => {
    const liveDay = await getOrCreateTradingDay(userId, SIM_DATE);
    const { day, trade } = await runInBacktestRun(userId, runId, async () => ({
      day: await getOrCreateTradingDay(userId, SIM_DATE),
      trade: await createTrade(userId, SIM_DATE, tradeInput()),
    }));

    expect(day.id).not.toBe(liveDay.id);
    expect(day.backtestRunId).toBe(runId);
    expect(liveDay.backtestRunId).toBeNull();
    expect(day.date.toISOString().slice(0, 10)).toBe(SIM_DATE);
    expect(trade.tradeDate.toISOString().slice(0, 10)).toBe(SIM_DATE);
    expect(trade.backtestRunId).toBe(runId);
  });

  it("changing the real system date does not alter stored historical records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-12-31T23:30:00Z"));
    const trade = await runInBacktestRun(userId, runId, () => createTrade(userId, "2024-05-16", tradeInput()));
    vi.setSystemTime(new Date("2035-07-01T08:00:00Z"));
    const reread = await runInBacktestRun(userId, runId, () => prisma.trade.findFirst({ where: { id: trade.id } }));
    expect(reread?.tradeDate.toISOString().slice(0, 10)).toBe("2024-05-16");
  });

  it("the resume pointer is stored server-side and stays inside the run", async () => {
    await touchBacktestRunSession(userId, runId, "2024-05-14");
    const run = await prisma.backtestRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.lastSessionDate?.toISOString().slice(0, 10)).toBe("2024-05-14");
    await expect(touchBacktestRunSession(userId, runId, "2024-07-01")).rejects.toBeInstanceOf(BacktestDateOutOfRangeError);
  });
});

describe("Run isolation — Run A never sees Run B", () => {
  let userId: string;
  let runA: string;
  let runB: string;

  beforeAll(async () => {
    userId = await user("runs");
    runA = (await newRun(userId, "Strategy V2 Jan-Jun")).id;
    runB = (await newRun(userId, "Strategy V3 Jan-Jun")).id;
  });

  it("the same date in two runs yields two independent days, trades and trade numbers", async () => {
    const a = await runInBacktestRun(userId, runA, async () => ({
      day: await getOrCreateTradingDay(userId, SIM_DATE),
      t1: await createTrade(userId, SIM_DATE, tradeInput()),
      t2: await createTrade(userId, SIM_DATE, tradeInput({ direction: "SHORT" })),
    }));
    const b = await runInBacktestRun(userId, runB, async () => ({
      day: await getOrCreateTradingDay(userId, SIM_DATE),
      t1: await createTrade(userId, SIM_DATE, tradeInput()),
    }));
    const live = await createTrade(userId, "2026-01-07", tradeInput());

    expect(a.day.id).not.toBe(b.day.id);
    expect([a.t1.tradeNumber, a.t2.tradeNumber]).toEqual([1, 2]);
    expect(b.t1.tradeNumber).toBe(1);
    expect(live.tradeNumber).toBe(1);

    const aTrades = await runInBacktestRun(userId, runA, () => listTradesForDay(userId, SIM_DATE));
    const bTrades = await runInBacktestRun(userId, runB, () => listTradesForDay(userId, SIM_DATE));
    expect(aTrades.map((t) => t.id).sort()).toEqual([a.t1.id, a.t2.id].sort());
    expect(bTrades.map((t) => t.id)).toEqual([b.t1.id]);
  });

  it("run-scoped opportunities stay in their run and link only within it", async () => {
    const input = await opportunityInput(userId);
    const opp = await runInBacktestRun(userId, runA, () => createOpportunity(userId, SIM_DATE, input));
    expect(opp.backtestRunId).toBe(runA);
    const inB = await runInBacktestRun(userId, runB, () => prisma.tradeOpportunity.findMany({ where: { userId } }));
    expect(inB).toHaveLength(0);
    expect(await prisma.tradeOpportunity.findMany({ where: { userId } })).toHaveLength(0);

    const bTrade = await runInBacktestRun(userId, runB, () => createTrade(userId, SIM_DATE, tradeInput()));
    // From run B's scope, run A's opportunity simply doesn't exist.
    await expect(runInBacktestRun(userId, runB, () => linkExecutedTrade(userId, opp.id, bTrade.id))).rejects.toThrow();
  });

  it("deleting a run removes only that run's simulated data", async () => {
    const liveBefore = await prisma.trade.count({ where: { userId } });
    await prisma.backtestRun.delete({ where: { id: runB } });
    expect(await runUnscoped("test", () => prisma.trade.count({ where: { backtestRunId: runB } }))).toBe(0);
    expect(await runInBacktestRun(userId, runA, () => prisma.trade.count({ where: { userId } }))).toBe(2);
    expect(await prisma.trade.count({ where: { userId } })).toBe(liveBefore);
  });
});

describe("Strategy snapshot — a run stays interpretable after Strategy Lab edits", () => {
  it("freezes the strategy name/version/tree at run creation", async () => {
    const userId = await user("strategy");
    const strategy = await createStrategy(userId, { name: "London Sweep", description: undefined });
    const run = await newRun(userId, "Sweep backtest", { strategyId: strategy.id });

    await renameStrategy(userId, strategy.id, "London Sweep (edited)");

    const reread = await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(reread.strategyId).toBe(strategy.id);
    expect(reread.strategyNameSnapshot).toBe("London Sweep");
    expect(reread.strategyVersionSnapshot).toBe(strategy.version);
    expect((reread.strategySnapshot as { name: string }).name).toBe("London Sweep");
  });
});
