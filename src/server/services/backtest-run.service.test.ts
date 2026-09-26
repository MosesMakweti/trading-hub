import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import * as mediaStorage from "@/lib/media-storage";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import {
  BacktestDateOutOfRangeError,
  BacktestRunNotFoundError,
  BacktestRunValidationError,
  createBacktestRun,
  deleteBacktestRun,
  getBacktestRunOverview,
  listBacktestRunOverviews,
  recordBacktestPosition,
  runInBacktestRun,
  setBacktestRunStatus,
} from "@/server/services/backtest-run.service";
import { archiveTrade, createTrade, updateTradeSections } from "@/server/services/trades.service";
import { endDay } from "@/server/services/trading-day.service";
import { attachMedia, createStandaloneMediaAsset } from "@/server/services/media.service";
import { attachPlanScreenshot } from "@/server/services/trade-plan.service";
import { createOrGetDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { createOpportunity, logMissedOutcome } from "@/server/services/opportunity.service";
import {
  createStrategy,
  deleteStrategy,
  renameStrategy,
  setStrategyStatus,
  updateStrategySettings,
} from "@/server/services/strategies.service";
import { runUnscoped } from "@/server/workspace/scope";
import type { CreateBacktestRunInput } from "@/lib/validation/backtesting";
import type { TradeInput } from "@/lib/validation/trades";

vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, deleteMediaFile: vi.fn(async () => {}) };
});

/**
 * Backtesting Stage 2 — run management (real Postgres, trading_hub_test):
 * creation, ownership, resume/progress semantics, isolation of management
 * operations, archive, and reference-safe deletion including media.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => vi.mocked(mediaStorage.deleteMediaFile).mockClear());

async function user(label: string) {
  const u = await createTestUser(`bt-run-${label}`);
  userIds.push(u.id);
  return u.id;
}

// Jan 2024 — Mon 1st. Jan 1–31 has 23 weekdays.
function runInput(overrides: Partial<CreateBacktestRunInput> = {}): CreateBacktestRunInput {
  return createBacktestRunSchema.parse({
    name: "EURUSD Strategy V3",
    assets: ["EURUSD"],
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    tradingWeekdays: [1, 2, 3, 4, 5],
    ...overrides,
  });
}

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

let keyCounter = 0;
function storageKey(userId: string) {
  keyCounter += 1;
  return `${userId}/bt-${Date.now()}-${keyCounter}.png`;
}

async function attachTradeImage(userId: string, tradeId: string) {
  const key = storageKey(userId);
  await attachMedia({ userId, ownerType: "TRADE", ownerId: tradeId, category: "BEFORE", storageKey: key, fileName: "a.png", mimeType: "image/png", fileSize: 10 });
  return key;
}

async function liveRowCounts(userId: string) {
  return {
    days: await prisma.tradingDay.count({ where: { userId } }),
    trades: await prisma.trade.count({ where: { userId } }),
    accounts: await prisma.tradingAccount.count({ where: { userId } }),
  };
}

describe("Creation", () => {
  it("creates a run with its strategy snapshot, calendar and initial position", async () => {
    const userId = await user("create");
    const strategy = await createStrategy(userId, { name: "London Continuation", description: undefined });
    await updateStrategySettings(userId, strategy.id, {
      name: "London Continuation",
      description: undefined,
      applicableAssets: ["EURUSD", "GBPUSD"],
      status: "TESTING",
    });

    const run = await createBacktestRun(userId, runInput({ strategyId: strategy.id, startingBalance: 10_000, currency: "USD" }));
    const overview = await getBacktestRunOverview(userId, run.id);

    expect(run.strategyNameSnapshot).toBe("London Continuation");
    expect((run.strategySnapshot as { applicableAssets: string[] }).applicableAssets).toEqual(["EURUSD", "GBPUSD"]);
    expect(overview?.strategy).toEqual({ id: strategy.id, name: "London Continuation", version: 1 });
    expect(overview?.progress).toMatchObject({ totalTradingDays: 23, completedTradingDays: 0, percentComplete: 0 });
    expect(overview?.currentPositionDateKey).toBeNull();
    expect(overview?.resumeDateKey).toBe("2024-01-01");
    expect(overview?.simulation).toEqual({ startingBalance: 10_000, riskPercentPerTrade: null, currency: "USD" });
    expect(overview?.stats).toEqual({ executedTrades: 0, closedTrades: 0, netR: null, winRate: null, missedTrades: 0 });
  });

  it("rejects assets outside the strategy's declared markets, with a useful message", async () => {
    const userId = await user("assets");
    const strategy = await createStrategy(userId, { name: "Gold Only", description: undefined });
    await updateStrategySettings(userId, strategy.id, { name: "Gold Only", description: undefined, applicableAssets: ["XAUUSD"], status: "DRAFT" });

    await expect(createBacktestRun(userId, runInput({ strategyId: strategy.id, assets: ["EURUSD"] }))).rejects.toThrow(
      new BacktestRunValidationError("EURUSD isn't among Gold Only's markets (XAUUSD)."),
    );
    // A strategy with no declared markets accepts any asset.
    const open = await createStrategy(userId, { name: "Any Market", description: undefined });
    await expect(createBacktestRun(userId, runInput({ strategyId: open.id, assets: ["NAS100"] }))).resolves.toBeTruthy();
  });

  it("validates the period, weekdays and assets", () => {
    const base = { name: "x", assets: ["EURUSD"], startDate: "2024-02-01", endDate: "2024-01-01" };
    expect(createBacktestRunSchema.safeParse(base).error?.issues[0]?.message).toBe("End date must be on or after the start date.");
    expect(
      createBacktestRunSchema.safeParse({ ...base, startDate: "2024-01-06", endDate: "2024-01-07" }).error?.issues[0]?.message,
    ).toBe("This period has no trading days for the selected weekdays.");
    expect(createBacktestRunSchema.safeParse({ ...base, endDate: "2024-03-01", assets: [] }).error?.issues[0]?.message).toBe(
      "Add at least one asset to test.",
    );
  });

  it("keeps the simulated balance isolated — creating/listing/updating runs writes no live rows", async () => {
    const userId = await user("iso");
    const before = await liveRowCounts(userId);
    const run = await createBacktestRun(userId, runInput({ startingBalance: 25_000 }));
    await listBacktestRunOverviews(userId);
    await recordBacktestPosition(userId, run.id, "2024-01-10");
    await setBacktestRunStatus(userId, run.id, "COMPLETED");
    expect(await liveRowCounts(userId)).toEqual(before);
    expect(await runUnscoped("test", () => prisma.tradingDay.count({ where: { userId } }))).toBe(0);
  });
});

describe("Ownership", () => {
  it("another user can't read, continue, change status or delete the run", async () => {
    const owner = await user("owner");
    const intruder = await user("intruder");
    const run = await createBacktestRun(owner, runInput());

    expect(await getBacktestRunOverview(intruder, run.id)).toBeNull();
    expect(await listBacktestRunOverviews(intruder)).toEqual([]);
    await expect(recordBacktestPosition(intruder, run.id, "2024-01-10")).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(setBacktestRunStatus(intruder, run.id, "ARCHIVED")).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(deleteBacktestRun(intruder, run.id)).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(runInBacktestRun(intruder, run.id, async () => null)).rejects.toBeInstanceOf(BacktestRunNotFoundError);

    const reread = await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(reread.status).toBe("ACTIVE");
    expect(reread.lastSessionDate).toBeNull();
  });
});

describe("Resume, position and progress", () => {
  it("position is stored server-side; completion is a separate, explicit fact", async () => {
    const userId = await user("resume");
    const run = await createBacktestRun(userId, runInput());

    await recordBacktestPosition(userId, run.id, "2024-01-12"); // Friday, visited only
    let overview = await getBacktestRunOverview(userId, run.id); // a "refresh" = a fresh read
    expect(overview?.currentPositionDateKey).toBe("2024-01-12");
    expect(overview?.resumeDateKey).toBe("2024-01-12");
    expect(overview?.progress.completedTradingDays).toBe(0);

    // Closing that simulated day completes it, and Continue moves past the weekend.
    await runInBacktestRun(userId, run.id, () => endDay(userId, "2024-01-12"));
    overview = await getBacktestRunOverview(userId, run.id);
    expect(overview?.progress.completedTradingDays).toBe(1);
    expect(overview?.resumeDateKey).toBe("2024-01-15");
  });

  it("ignores non-trading days, refuses out-of-range dates, and freezes position once the run isn't active", async () => {
    const userId = await user("resume-rules");
    const run = await createBacktestRun(userId, runInput());

    expect(await recordBacktestPosition(userId, run.id, "2024-01-13")).toBe(false); // Saturday
    await expect(recordBacktestPosition(userId, run.id, "2024-02-01")).rejects.toBeInstanceOf(BacktestDateOutOfRangeError);

    await recordBacktestPosition(userId, run.id, "2024-01-10");
    await setBacktestRunStatus(userId, run.id, "ARCHIVED");
    expect(await recordBacktestPosition(userId, run.id, "2024-01-11")).toBe(false);
    expect((await getBacktestRunOverview(userId, run.id))?.currentPositionDateKey).toBe("2024-01-10");
  });

  it("run A's position and progress never move run B", async () => {
    const userId = await user("resume-ab");
    const a = await createBacktestRun(userId, runInput({ name: "A" }));
    const b = await createBacktestRun(userId, runInput({ name: "B" }));
    await recordBacktestPosition(userId, a.id, "2024-01-22");
    await runInBacktestRun(userId, a.id, () => endDay(userId, "2024-01-22"));

    const overviewB = await getBacktestRunOverview(userId, b.id);
    expect(overviewB?.currentPositionDateKey).toBeNull();
    expect(overviewB?.progress.completedTradingDays).toBe(0);
    const list = await listBacktestRunOverviews(userId);
    expect(list.map((r) => r.name)).toEqual(["A", "B"]); // most recently worked-on first
  });
});

describe("Run statistics come only from the run's own scoped rows", () => {
  it("counts executed (not cancelled, not unexecuted, not soft-deleted) and missed trades", async () => {
    const userId = await user("stats");
    const strategy = await createStrategy(userId, { name: "Stats Strat", description: undefined });
    const run = await createBacktestRun(userId, runInput());
    const other = await createBacktestRun(userId, runInput({ name: "Other" }));

    await runInBacktestRun(userId, run.id, async () => {
      const executed = await createTrade(userId, "2024-01-10", tradeInput());
      await updateTradeSections(userId, executed.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.11 });
      await createTrade(userId, "2024-01-10", tradeInput()); // idea only — not executed
      const deleted = await createTrade(userId, "2024-01-11", tradeInput());
      await updateTradeSections(userId, deleted.id, { actualEntry: 1.1 });
      await archiveTrade(userId, deleted.id);
      const opp = await createOpportunity(userId, "2024-01-11", {
        strategyId: strategy.id, assetSymbol: "EURUSD", direction: "LONG", timeframe: null,
        selectedConfluences: [], selectedExecution: [], plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
      });
      await logMissedOutcome(userId, opp.id, { missReason: "HESITATION", missNote: null, missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null });
    });
    const liveTrade = await createTrade(userId, "2024-01-10", tradeInput());
    await updateTradeSections(userId, liveTrade.id, { actualEntry: 1.2 });

    const overviews = await listBacktestRunOverviews(userId);
    // One closed +2R trade (price-derived), one idea, one soft-deleted, one missed setup.
    expect(overviews.find((o) => o.id === run.id)?.stats).toEqual({ executedTrades: 1, closedTrades: 1, netR: 2, winRate: 100, missedTrades: 1 });
    expect(overviews.find((o) => o.id === other.id)?.stats).toEqual({ executedTrades: 0, closedTrades: 0, netR: null, winRate: null, missedTrades: 0 });
  });
});

describe("Strategy snapshot / drift", () => {
  it("detects later Strategy Lab edits without ever rewriting the run's snapshot", async () => {
    const userId = await user("drift");
    const strategy = await createStrategy(userId, { name: "Sweep", description: undefined });
    const run = await createBacktestRun(userId, runInput({ strategyId: strategy.id }));
    const frozen = (await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } })).strategySnapshot;

    expect((await getBacktestRunOverview(userId, run.id))?.strategyDrift).toBe("UNCHANGED");
    await setStrategyStatus(userId, strategy.id, "LIVE"); // promotion isn't a methodology change
    expect((await getBacktestRunOverview(userId, run.id))?.strategyDrift).toBe("UNCHANGED");

    await renameStrategy(userId, strategy.id, "Sweep v2");
    expect((await getBacktestRunOverview(userId, run.id))?.strategyDrift).toBe("CHANGED");

    await deleteStrategy(userId, strategy.id);
    const overview = await getBacktestRunOverview(userId, run.id);
    expect(overview?.strategyDrift).toBe("STRATEGY_REMOVED");
    expect(overview?.strategy?.name).toBe("Sweep");

    const after = await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.strategySnapshot).toEqual(frozen);
    expect(after.strategyNameSnapshot).toBe("Sweep");
  });
});

describe("Archive", () => {
  it("preserves every simulated record, screenshot and the snapshot, and can be restored", async () => {
    const userId = await user("archive");
    const strategy = await createStrategy(userId, { name: "Arch", description: undefined });
    const run = await createBacktestRun(userId, runInput({ strategyId: strategy.id }));
    const tradeId = await runInBacktestRun(userId, run.id, async () => {
      const t = await createTrade(userId, "2024-01-10", tradeInput());
      await attachTradeImage(userId, t.id);
      await endDay(userId, "2024-01-10");
      return t.id;
    });

    await setBacktestRunStatus(userId, run.id, "ARCHIVED");
    const archived = await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.strategySnapshot).not.toBeNull();
    expect(await runInBacktestRun(userId, run.id, () => prisma.trade.count({ where: { userId } }))).toBe(1);
    expect(await prisma.mediaAttachment.count({ where: { ownerType: "TRADE", ownerId: tradeId } })).toBe(1);
    expect((await getBacktestRunOverview(userId, run.id))?.progress.completedTradingDays).toBe(1);

    await setBacktestRunStatus(userId, run.id, "ACTIVE");
    expect((await prisma.backtestRun.findUniqueOrThrow({ where: { id: run.id } })).archivedAt).toBeNull();
  });
});

describe("Delete", () => {
  it("removes all run-owned data and exactly the run's media — never live or another run's", async () => {
    const userId = await user("delete");
    const run = await createBacktestRun(userId, runInput({ name: "Doomed" }));
    const keeper = await createBacktestRun(userId, runInput({ name: "Keeper" }));

    const doomed = await runInBacktestRun(userId, run.id, async () => {
      const trade = await createTrade(userId, "2024-01-10", tradeInput());
      const tradeKey = await attachTradeImage(userId, trade.id);
      const shotKey = storageKey(userId);
      const standalone = await createStandaloneMediaAsset({ userId, storageKey: shotKey, fileName: "s.png", mimeType: "image/png", fileSize: 10 });
      await attachPlanScreenshot(userId, trade.id, standalone.id);
      const analysis = await createOrGetDailyAssetAnalysis(userId, "2024-01-10", "EURUSD");
      const analysisKey = storageKey(userId);
      await attachMedia({ userId, ownerType: "DAILY_ASSET_ANALYSIS", ownerId: analysis.id, category: null, timeframe: "15M", storageKey: analysisKey, fileName: "b.png", mimeType: "image/png", fileSize: 10 });
      const softDeleted = await createTrade(userId, "2024-01-11", tradeInput());
      const softKey = await attachTradeImage(userId, softDeleted.id);
      await archiveTrade(userId, softDeleted.id);
      return { tradeId: trade.id, keys: [tradeKey, shotKey, analysisKey, softKey] };
    });
    const keeperKey = await runInBacktestRun(userId, keeper.id, async () => {
      const t = await createTrade(userId, "2024-01-10", tradeInput());
      return attachTradeImage(userId, t.id);
    });
    const liveTrade = await createTrade(userId, "2024-01-10", tradeInput());
    const liveKey = await attachTradeImage(userId, liveTrade.id);

    const result = await deleteBacktestRun(userId, run.id);

    expect(result).toEqual({ deletedTrades: 2, deletedMediaAssets: 4, storageCleanupFailures: 0 });
    const deletedKeys = vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0]);
    expect(deletedKeys.sort()).toEqual([...doomed.keys].sort());

    expect(await prisma.backtestRun.findUnique({ where: { id: run.id } })).toBeNull();
    await runUnscoped("test", async () => {
      expect(await prisma.trade.count({ where: { backtestRunId: run.id } })).toBe(0);
      expect(await prisma.tradingDay.count({ where: { backtestRunId: run.id } })).toBe(0);
    });
    expect(await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "Trade" WHERE "backtestRunId" = ${run.id}`).toEqual([{ n: 0 }]);
    expect(await prisma.mediaAsset.count({ where: { storageKey: { in: doomed.keys } } })).toBe(0);
    expect(await prisma.mediaAttachment.count({ where: { ownerId: doomed.tradeId } })).toBe(0);

    // Live and the other run are untouched.
    expect(await prisma.mediaAsset.count({ where: { storageKey: { in: [keeperKey, liveKey] } } })).toBe(2);
    expect(await prisma.trade.count({ where: { userId } })).toBe(1);
    expect(await runInBacktestRun(userId, keeper.id, () => prisma.trade.count({ where: { userId } }))).toBe(1);
  });

  it("keeps an asset that is still referenced elsewhere, removing only the run's attachment", async () => {
    const userId = await user("delete-shared");
    const run = await createBacktestRun(userId, runInput());
    const liveTrade = await createTrade(userId, "2024-01-10", tradeInput());
    const sharedKey = await attachTradeImage(userId, liveTrade.id);
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { storageKey: sharedKey } });
    const btTradeId = await runInBacktestRun(userId, run.id, async () => (await createTrade(userId, "2024-01-10", tradeInput())).id);
    await prisma.mediaAttachment.create({ data: { mediaId: asset.id, ownerType: "TRADE", ownerId: btTradeId } });

    const result = await deleteBacktestRun(userId, run.id);

    expect(result.deletedMediaAssets).toBe(0);
    expect(mediaStorage.deleteMediaFile).not.toHaveBeenCalled();
    expect(await prisma.mediaAttachment.count({ where: { mediaId: asset.id } })).toBe(1);
    expect(await prisma.mediaAttachment.count({ where: { mediaId: asset.id, ownerId: liveTrade.id } })).toBe(1);
  });

  it("a storage failure after commit leaves the database consistent and is reported", async () => {
    const userId = await user("delete-fail");
    const run = await createBacktestRun(userId, runInput());
    await runInBacktestRun(userId, run.id, async () => {
      const t = await createTrade(userId, "2024-01-10", tradeInput());
      await attachTradeImage(userId, t.id);
    });
    vi.mocked(mediaStorage.deleteMediaFile).mockRejectedValueOnce(new Error("R2 down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deleteBacktestRun(userId, run.id);

    expect(result.storageCleanupFailures).toBe(1);
    expect(await prisma.backtestRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await prisma.mediaAsset.count({ where: { userId } })).toBe(0);
    errorSpy.mockRestore();
  });
});
