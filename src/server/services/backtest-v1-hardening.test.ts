import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/media-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-storage")>("@/lib/media-storage");
  return { ...actual, deleteMediaFile: vi.fn(async () => {}) };
});

import * as mediaStorage from "@/lib/media-storage";
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { archivePastActiveDays, getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { attachMedia, createStandaloneMediaAsset } from "@/server/services/media.service";
import { attachPlanScreenshot } from "@/server/services/trade-plan.service";
import { getDailyNote, upsertDailyNote, getOrCreateDailyNote } from "@/server/services/journal.service";
import { deleteDataSection, getDataCounts, resetAllData } from "@/server/services/data-management.service";
import { createOpportunity, linkExecutedTrade, logMissedOutcome } from "@/server/services/opportunity.service";
import { getDayCloseSummary, listDailyPerformanceSummaries } from "@/server/services/close-day.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { createStrategy } from "@/server/services/strategies.service";
import { createApiToken } from "@/server/services/api-tokens.service";
import { resolveRecordScope } from "@/server/workspace/action-scope";
import { backtestScope, runLive, runUnscoped } from "@/server/workspace/scope";
import { fmtUsd } from "@/lib/analytics-format";
import { POST as createTradeViaApi } from "@/app/api/v1/trades/route";
import type { TradeInput } from "@/lib/validation/trades";

/**
 * Backtesting V1 — final hardening. One test per audited surface: extension
 * API, auto-archive, data management, daily notes, opportunity linking,
 * ownership guesses, raw-SQL record resolution, media integrity, and the
 * resolved semantics questions (missed count, day W/L, dollar formatting).
 */
const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
beforeEach(() => vi.mocked(mediaStorage.deleteMediaFile).mockClear());

async function user(label: string) {
  const u = await createTestUser(`bt-v1-${label}`);
  userIds.push(u.id);
  return u.id;
}
const newRun = (userId: string, name = "Run") =>
  createBacktestRun(userId, createBacktestRunSchema.parse({ name, assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));

function tradeInput(): TradeInput {
  return {
    strategyId: "", assetSymbol: "EURUSD", executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 70, selectedSession: null, expectedRR: 2, actualRR: null, performanceClosingPnlGross: 0,
    performanceClosingPnlNet: 0, psychPreTradeMindset: null, psychPostTradeReflection: null, psychLessonsLearned: null,
    psychWhatToWorkOn: null, allocations: [], propFirmExecutions: [], selectedConfluences: [], selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no", riskManaged: "yes", followedExitPlan: "yes", alignedWithBias: "yes", influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no", outcomeWillInfluenceNext: "no", monitoringObsession: 10,
    },
  } as unknown as TradeInput;
}
let keyN = 0;
const key = (userId: string) => `${userId}/v1-${Date.now()}-${++keyN}.png`;
async function image(userId: string, ownerType: "TRADE" | "DAILY_NOTE" | "DAILY_ASSET_ANALYSIS", ownerId: string) {
  const storageKey = key(userId);
  await attachMedia({ userId, ownerType, ownerId, category: ownerType === "TRADE" ? "BEFORE" : null, timeframe: ownerType === "DAILY_ASSET_ANALYSIS" ? "15M" : null, storageKey, fileName: "a.png", mimeType: "image/png", fileSize: 1 });
  return storageKey;
}
const assetExists = async (storageKey: string) => (await prisma.mediaAsset.count({ where: { storageKey } })) === 1;
async function opportunityInput(userId: string) {
  const strategy = await createStrategy(userId, { name: `S ${Math.random().toString(36).slice(2)}`, description: undefined });
  return {
    strategyId: strategy.id, assetSymbol: "EURUSD", direction: "LONG", timeframe: null, selectedConfluences: [], selectedExecution: [],
    plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
  } as Parameters<typeof createOpportunity>[2];
}

describe("TradingView extension API is LIVE-only", () => {
  it("ignores a supplied backtestRunId (top-level or inside trade), even when called inside a backtest scope", async () => {
    const userId = await user("api");
    const run = await newRun(userId);
    const { rawToken } = await createApiToken(userId, "t");
    const body = {
      backtestRunId: run.id,
      trade: { assetSymbol: "EURUSD", executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 80, backtestRunId: run.id, tradeDate: "2024-05-14" },
    };
    const call = () =>
      createTradeViaApi(new Request("http://localhost/api/v1/trades", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${rawToken}` }, body: JSON.stringify(body) }));
    expect((await call()).status).toBeLessThan(300);
    expect((await runInBacktestRun(userId, run.id, call)).status).toBeLessThan(300);

    const rows = await runUnscoped("test", () => prisma.trade.findMany({ where: { userId }, select: { backtestRunId: true } }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.backtestRunId === null)).toBe(true);
  });
});

describe("live housekeeping never touches Backtest Runs", () => {
  it("auto-archive closes only past LIVE days", async () => {
    const userId = await user("archive");
    const run = await newRun(userId);
    await getOrCreateTradingDay(userId, "2024-05-14");
    await runInBacktestRun(userId, run.id, () => getOrCreateTradingDay(userId, "2024-05-14"));

    expect(await runLive(() => archivePastActiveDays(userId, "2026-09-26"))).toBe(1);
    expect((await getTradingDay(userId, "2024-05-14"))?.status).toBe("ARCHIVED");
    expect((await runInBacktestRun(userId, run.id, () => getTradingDay(userId, "2024-05-14")))?.status).toBe("ACTIVE");
  });
});

describe("data management treats Backtesting as its own category", () => {
  async function seed(userId: string) {
    const run = await newRun(userId);
    const live = await createTrade(userId, "2024-05-14", tradeInput());
    const liveKey = await image(userId, "TRADE", live.id);
    const shotKey = key(userId);
    const shot = await createStandaloneMediaAsset({ userId, storageKey: shotKey, fileName: "s.png", mimeType: "image/png", fileSize: 1 });
    await attachPlanScreenshot(userId, live.id, shot.id); // exercises the RESTRICT screenshot FK
    const liveNote = await upsertDailyNote(userId, "2024-05-14", { content: { type: "doc" } });
    const liveNoteKey = await image(userId, "DAILY_NOTE", liveNote.id);
    const bt = await runInBacktestRun(userId, run.id, async () => {
      const t = await createTrade(userId, "2024-05-14", tradeInput());
      const note = await upsertDailyNote(userId, "2024-05-14", { content: { type: "doc" } });
      return { tradeKey: await image(userId, "TRADE", t.id), noteKey: await image(userId, "DAILY_NOTE", note.id) };
    });
    return { run, liveKey, shotKey, liveNoteKey, bt };
  }

  it("deleting live Journal & Trades keeps every Backtest Run record and screenshot (and handles plan screenshots)", async () => {
    const userId = await user("dm-trades");
    const s = await seed(userId);
    await deleteDataSection(userId, "journal-trades");

    expect(await prisma.trade.count({ where: { userId } })).toBe(0);
    expect(await assetExists(s.liveKey)).toBe(false);
    expect(await assetExists(s.shotKey)).toBe(false);
    expect(await runInBacktestRun(userId, s.run.id, () => prisma.trade.count({ where: { userId } }))).toBe(1);
    expect(await assetExists(s.bt.tradeKey)).toBe(true);
    expect(vi.mocked(mediaStorage.deleteMediaFile).mock.calls.map((c) => c[0]).sort()).toEqual([s.liveKey, s.shotKey].sort());
  });

  it("deleting live notes keeps the run's notes and their images", async () => {
    const userId = await user("dm-notes");
    const s = await seed(userId);
    await deleteDataSection(userId, "notes");
    expect(await getDailyNote(userId, "2024-05-14")).toBeNull();
    expect(await assetExists(s.liveNoteKey)).toBe(false);
    expect(await runInBacktestRun(userId, s.run.id, () => getDailyNote(userId, "2024-05-14"))).not.toBeNull();
    expect(await assetExists(s.bt.noteKey)).toBe(true);
  });

  it("the Backtesting section deletes only runs (with their media); live data stays", async () => {
    const userId = await user("dm-bt");
    const s = await seed(userId);
    expect((await getDataCounts(userId)).backtestRuns).toBe(1);
    await deleteDataSection(userId, "backtesting");
    expect(await prisma.backtestRun.count({ where: { userId } })).toBe(0);
    expect(await assetExists(s.bt.tradeKey)).toBe(false);
    expect(await assetExists(s.bt.noteKey)).toBe(false);
    expect(await prisma.trade.count({ where: { userId } })).toBe(1);
    expect(await assetExists(s.liveKey)).toBe(true);
    expect(await assetExists(s.shotKey)).toBe(true);
  });

  it("reset removes everything, Backtesting included, without FK failures", async () => {
    const userId = await user("dm-reset");
    await seed(userId);
    await resetAllData(userId);
    expect(await prisma.backtestRun.count({ where: { userId } })).toBe(0);
    expect(await runUnscoped("test", () => prisma.trade.count({ where: { userId } }))).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { userId } })).toBe(0);
  });
});

describe("daily notes are per environment", () => {
  it("LIVE note ≠ Run A note ≠ Run B note for the same date; environment is immutable", async () => {
    const userId = await user("notes");
    const [a, b] = [await newRun(userId, "A"), await newRun(userId, "B")];
    await upsertDailyNote(userId, "2024-05-14", { content: { live: true } });
    await runInBacktestRun(userId, a.id, () => upsertDailyNote(userId, "2024-05-14", { content: { run: "A" } }));
    await runInBacktestRun(userId, b.id, () => upsertDailyNote(userId, "2024-05-14", { content: { run: "B" } }));

    expect((await getDailyNote(userId, "2024-05-14"))?.content).toEqual({ live: true });
    expect((await runInBacktestRun(userId, a.id, () => getDailyNote(userId, "2024-05-14")))?.content).toEqual({ run: "A" });
    expect((await runInBacktestRun(userId, b.id, () => getDailyNote(userId, "2024-05-14")))?.content).toEqual({ run: "B" });

    const noteA = await runInBacktestRun(userId, a.id, () => getOrCreateDailyNote(userId, "2024-05-14"));
    await expect(runUnscoped("t", () => prisma.dailyNote.update({ where: { id: noteA.id }, data: { backtestRunId: b.id } }))).rejects.toThrow(/BACKTEST_ISOLATION/);
    expect(await resolveRecordScope(userId, { note: noteA.id }, "write")).toEqual(backtestScope(a.id));
  });
});

describe("log trade from opportunity stays inside the run", () => {
  it("links within the same run; a cross-run or live link is refused (app + database)", async () => {
    const userId = await user("opp");
    const [a, b] = [await newRun(userId, "A"), await newRun(userId, "B")];
    const input = await opportunityInput(userId);
    const oppA = await runInBacktestRun(userId, a.id, () => createOpportunity(userId, "2024-05-14", input));
    const tradeA = await runInBacktestRun(userId, a.id, () => createTrade(userId, "2024-05-14", tradeInput()));
    await runInBacktestRun(userId, a.id, () => linkExecutedTrade(userId, oppA.id, tradeA.id));
    expect((await runInBacktestRun(userId, a.id, () => prisma.tradeOpportunity.findFirstOrThrow({ where: { id: oppA.id } }))).status).toBe("EXECUTED");

    const oppA2 = await runInBacktestRun(userId, a.id, () => createOpportunity(userId, "2024-05-14", input));
    const tradeB = await runInBacktestRun(userId, b.id, () => createTrade(userId, "2024-05-14", tradeInput()));
    await expect(runInBacktestRun(userId, b.id, () => linkExecutedTrade(userId, oppA2.id, tradeB.id))).rejects.toThrow();
    const live = await createTrade(userId, "2024-05-14", tradeInput());
    await expect(linkExecutedTrade(userId, oppA2.id, live.id)).rejects.toThrow();
    await expect(runUnscoped("t", () => prisma.trade.update({ where: { id: tradeB.id }, data: { opportunityId: oppA2.id } }))).rejects.toThrow(/BACKTEST_ISOLATION/);
  });
});

describe("ownership — guessed ids reveal nothing", () => {
  it("another user's run, trade, opportunity and note resolve to nothing", async () => {
    const owner = await user("own-a");
    const intruder = await user("own-b");
    const run = await newRun(owner);
    const { trade, opp, note } = await runInBacktestRun(owner, run.id, async () => ({
      trade: await createTrade(owner, "2024-05-14", tradeInput()),
      opp: await createOpportunity(owner, "2024-05-14", await opportunityInput(owner)),
      note: await getOrCreateDailyNote(owner, "2024-05-14"),
    }));
    // Record resolution (raw SQL, user-scoped) finds nothing for the intruder → LIVE scope → normal not-found.
    for (const ref of [{ trade: trade.id }, { opportunity: opp.id }, { note: note.id }] as const) {
      expect(await resolveRecordScope(intruder, ref, "write")).toEqual({ environment: "LIVE" });
    }
    expect(await prisma.trade.findFirst({ where: { id: trade.id, userId: intruder } })).toBeNull();
    await expect(runInBacktestRun(intruder, run.id, async () => null)).rejects.toThrow("Backtest run not found.");
  });
});

describe("resolved semantics", () => {
  it("Day Summary counts only setups scored valid as missed (matches the Discrepancy Gap)", async () => {
    const userId = await user("missed");
    const input = await opportunityInput(userId);
    const opp = await createOpportunity(userId, "2024-05-14", input);
    await logMissedOutcome(userId, opp.id, { missReason: "HESITATION", missNote: null, missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null });
    // An unscored (setupValid NULL) missed setup is not counted.
    await prisma.tradeOpportunity.create({ data: { userId, spottedAt: new Date("2024-05-14"), assetSymbol: "EURUSD", direction: "LONG", status: "MISSED", setupValid: null } });
    await prisma.tradeOpportunity.create({ data: { userId, spottedAt: new Date("2024-05-14"), assetSymbol: "EURUSD", direction: "LONG", status: "MISSED", setupValid: false } });
    expect((await getDayCloseSummary(userId, "2024-05-14")).missedValidOpportunityCount).toBe(1);
    expect((await listDailyPerformanceSummaries(userId)).find((d) => d.dateKey === "2024-05-14")?.missedCount).toBe(1);
  });

  it("day W/L: LIVE Journal and LIVE Analytics classify the same settled trades identically", async () => {
    const userId = await user("wl-live");
    const d = "2024-05-14";
    // Settled winner, settled loser, settled breakeven — none confirmed in Trade Review.
    const win = await createTrade(userId, d, tradeInput());
    await updateTradeSections(userId, win.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.11 });
    const loss = await createTrade(userId, d, tradeInput());
    await updateTradeSections(userId, loss.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.095 });
    const be = await createTrade(userId, d, tradeInput());
    await updateTradeSections(userId, be.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.1 });
    // Still open (no exit) — unsettled: no result anywhere.
    const open = await createTrade(userId, d, tradeInput());
    await updateTradeSections(userId, open.id, { actualEntry: 1.1, actualStopLoss: 1.095 });
    // Marked Fully Closed but not settled (no stop, no exit): not a result, only a warning.
    const marked = await createTrade(userId, d, tradeInput());
    await updateTradeSections(userId, marked.id, { actualEntry: 1.1 });
    await prisma.trade.update({ where: { id: marked.id }, data: { reviewLifecycleStatus: "FULLY_CLOSED" } });

    const rows = await getCanonicalAnalyticsDataset(userId, { from: d, to: d });
    const cls = (id: string) => rows.find((r) => r.tradeId === id)?.winLossClass;
    expect([cls(win.id), cls(loss.id), cls(be.id), cls(open.id), cls(marked.id)]).toEqual(["WIN", "LOSS", "BREAKEVEN", "PENDING", "PENDING"]);
    const analytics = { wins: rows.filter((r) => r.winLossClass === "WIN").length, losses: rows.filter((r) => r.winLossClass === "LOSS").length, breakevens: rows.filter((r) => r.winLossClass === "BREAKEVEN").length };

    const journalDay = (await listDailyPerformanceSummaries(userId)).find((x) => x.dateKey === d)!;
    expect({ wins: journalDay.wins, losses: journalDay.losses, breakevens: journalDay.breakevens }).toEqual(analytics);
    expect(analytics).toEqual({ wins: 1, losses: 1, breakevens: 1 });

    const close = await getDayCloseSummary(userId, d);
    expect({ wins: close.wins, losses: close.losses, breakevens: close.breakevens }).toEqual(analytics);
    expect(close.warnings.some((w) => /marked Fully Closed/.test(w))).toBe(true);
  });

  it("day W/L: BACKTEST unchanged — price-derived finalized result, no Fully-Closed warning", async () => {
    const userId = await user("wl-bt");
    const run = await newRun(userId);
    const res = await runInBacktestRun(userId, run.id, async () => {
      const t = await createTrade(userId, "2024-05-14", tradeInput());
      await updateTradeSections(userId, t.id, { actualEntry: 1.1, actualStopLoss: 1.095, actualExit: 1.11 });
      const m = await createTrade(userId, "2024-05-14", tradeInput());
      await updateTradeSections(userId, m.id, { actualEntry: 1.1 });
      await prisma.trade.update({ where: { id: m.id }, data: { reviewLifecycleStatus: "FULLY_CLOSED" } });
      const rows = await getCanonicalAnalyticsDataset(userId, { from: "2024-05-14", to: "2024-05-14" });
      return { day: (await listDailyPerformanceSummaries(userId))[0], close: await getDayCloseSummary(userId, "2024-05-14"), rows };
    });
    expect(res.day).toMatchObject({ wins: 1, losses: 0, breakevens: 0 });
    expect(res.close.wins).toBe(1);
    expect(res.close.warnings.some((w) => /marked Fully Closed/.test(w))).toBe(false);
    expect(res.rows.filter((r) => r.winLossClass === "WIN")).toHaveLength(1);
  });

  it("fmtUsd keeps the sign", () => {
    expect(fmtUsd(500)).toBe("+$500");
    expect(fmtUsd(-500)).toBe("-$500");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(-1234.6)).toBe("-$1,235");
  });
});
