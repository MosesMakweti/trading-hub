import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { tradeSchema } from "@/lib/validation/trades";
import { getOrCreateTradingDay, endDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { createOrGetDailyAssetAnalysis, updateDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { createTrade, getTrade, updateTradeSections } from "@/server/services/trades.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";
import { tradeExecutionEditableGuard } from "@/actions/day-guard";
import {
  LimitOverrideRequiredError,
  TradingNotReadyError,
  createQuickIdea,
  getDayLimitState,
  listCarriedOpenTrades,
  recordFirstEntry,
  updateEntryTime,
  updateExecutionConfirmations,
  updateIdea,
} from "@/server/services/today-trade.service";

/**
 * Today V3 (Phase 2) — integration tests against the test Postgres DB for
 * the V3 trade lifecycle: readiness gate, Quick Idea compatibility values,
 * soft-limit overrides, real entry time + Performance ledger ordering, the
 * initial/current stop split, execution-confirmation scoring, carried
 * positions and the shared trade→form mapper.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

/** A user whose routine has no mandatory items and is confirmed ready. */
async function readyUser(label: string, dateKey: string) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
  await prisma.routineItem.create({
    data: { userId: user.id, sectionId: section.id, label: "Optional only", type: "CHECKBOX", isMandatory: false, sortOrder: 0 },
  });
  await runLive(async () => {
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineReady(user.id, dateKey, true);
  });
  return user;
}

function idea(overrides: Record<string, unknown> = {}) {
  return quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 615, ...overrides });
}

function entry(overrides: Record<string, unknown> = {}) {
  return recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600, ...overrides });
}

async function confirmPlan(userId: string, tradeId: string, stopLoss = 1890) {
  await savePlan(userId, tradeId, {
    direction: "LONG",
    timeframe: "15m",
    entry: 1900,
    stopLoss,
    targets: [
      { targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 50 },
      { targetOrder: 2, label: "TP2", targetPrice: 1920, plannedClosePercent: 50 },
    ],
  });
}

describe("Quick Trade Idea", () => {
  it("is gated on readiness (taking a new trade), and Plan facts are inherited, not asked", async () => {
    const dateKey = "2026-09-01";
    const user = await createTestUser("v3q-gate");
    userIds.push(user.id);
    await runLive(async () => {
      // Default routine has mandatory items → not ready.
      await expect(createQuickIdea(user.id, dateKey, idea())).rejects.toBeInstanceOf(TradingNotReadyError);
    });
  });

  it("writes compatibility values (provisional time, HTF from asset, neutral 50) and freezes the daily bias", async () => {
    const dateKey = "2026-09-02";
    const user = await readyUser("v3q-create", dateKey);
    await runLive(async () => {
      const analysis = await createOrGetDailyAssetAnalysis(user.id, dateKey, "XAUUSD");
      await updateDailyAssetAnalysis(user.id, analysis.id, { htfBias: "BEARISH", finalBias: "SHORT" });

      const { tradeId } = await createQuickIdea(
        user.id,
        dateKey,
        idea({ direction: "SHORT", reasonForTrade: "Sweep of Asia high", preTradeMoodTags: ["CALM"], nowMinutes: 615 }),
      );
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(t.direction).toBe("SHORT");
      expect(t.executionMinutes).toBe(615); // provisional, NOT 09:30
      expect(t.higherTimeframeBias).toBe("BEARISH");
      expect(t.biasConfidencePercent).toBe(50);
      expect(t.dailyBiasSnapshot).toBe("SHORT");
      expect(t.reasonForTrade).toBe("Sweep of Asia high");
      expect(t.preTradeMoodTags).toEqual(["CALM"]);
      expect(t.limitOverrideReason).toBeNull();
      expect(t.actualEntry).toBeNull();
    });
  });

  it("requires a reason past a CONFIRMED max-trades limit, stores it, and ignores unconfirmed limits", async () => {
    const dateKey = "2026-09-03";
    const user = await readyUser("v3q-limit", dateKey);
    await runLive(async () => {
      // No confirmed limit → no override regardless of count.
      const first = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, first.tradeId, entry({ actualStopLoss: 1890 }));

      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 1 } });

      // Ideas and cancelled ideas never consume the count.
      const pending = await createQuickIdea(user.id, dateKey, idea({ limitOverrideReason: "A+ setup" }));
      await setReviewLifecycleStatus(user.id, pending.tradeId, { status: "CANCELLED_NEVER_TRIGGERED" });
      const { usage } = await getDayLimitState(user.id, dateKey);
      expect(usage.executedCount).toBe(1);
      expect(usage.pendingIdeaCount).toBe(0);

      await expect(createQuickIdea(user.id, dateKey, idea())).rejects.toBeInstanceOf(LimitOverrideRequiredError);
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ limitOverrideReason: "News spike, planned" }));
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(t.limitOverrideReason).toBe("News spike, planned");
      expect(t.limitOverrideContext).toMatchObject({ kinds: ["MAX_TRADES"], maxTrades: 1, executedCount: 1 });

      // The confirmed limit is never raised by an override.
      const day = await prisma.tradingDay.findFirstOrThrow({ where: { userId: user.id } });
      expect(day.maxTradesPerDay).toBe(1);
    });
  });

  it("edits before entry keep every unshown field; after entry the idea is part of the record", async () => {
    const dateKey = "2026-09-04";
    const user = await readyUser("v3q-edit", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ preTradeMoodTags: ["FOCUSED"], preTradeMoodIntensity: 3 }));
      await updateIdea(user.id, tradeId, { direction: "SHORT", reasonForTrade: "changed mind" });
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(t.direction).toBe("SHORT");
      expect(t.preTradeMoodTags).toEqual(["FOCUSED"]);
      expect(t.preTradeMoodIntensity).toBe(3);
      expect(t.reasonForTrade).toBe("changed mind");

      await recordFirstEntry(user.id, dateKey, tradeId, entry({ actualStopLoss: 1910 }));
      await expect(updateIdea(user.id, tradeId, { direction: "LONG" })).rejects.toThrow(/entry/i);

      // A cancelled idea stays a trade, but is no longer editable or takeable.
      const cancelled = await createQuickIdea(user.id, dateKey, idea());
      await setReviewLifecycleStatus(user.id, cancelled.tradeId, { status: "CANCELLED_NEVER_TRIGGERED" });
      await expect(updateIdea(user.id, cancelled.tradeId, { direction: "SHORT" })).rejects.toThrow(/cancelled/i);
      await expect(recordFirstEntry(user.id, dateKey, cancelled.tradeId, entry({ actualStopLoss: 1890 }))).rejects.toThrow(/cancelled/i);
      expect(await prisma.trade.count({ where: { id: cancelled.tradeId } })).toBe(1);
    });
  });
});

describe("Execution — entry, stops, exits", () => {
  it("planless entry requires an explicit initial stop; real entry time replaces the provisional one", async () => {
    const dateKey = "2026-09-05";
    const user = await readyUser("v3x-planless", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ nowMinutes: 480 }));
      await expect(recordFirstEntry(user.id, dateKey, tradeId, entry())).rejects.toThrow(/initial stop/i);

      await recordFirstEntry(user.id, dateKey, tradeId, entry({ entryMinutes: 545, actualStopLoss: 1890 }));
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { performanceRiskSnapshot: true } });
      expect(t.executionMinutes).toBe(545);
      expect(t.performanceRiskSnapshot?.initialStop?.toNumber()).toBe(1890);
      await expect(recordFirstEntry(user.id, dateKey, tradeId, entry())).rejects.toThrow(/already recorded/i);
    });
  });

  it("a confirmed plan locks at first entry, its stop becomes the initial stop, and a locked revision needs a reason", async () => {
    const dateKey = "2026-09-06";
    const user = await readyUser("v3x-plan", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea());
      await confirmPlan(user.id, tradeId, 1890);
      await recordFirstEntry(user.id, dateKey, tradeId, entry()); // no stop typed: inherited from the plan
      const versions = await prisma.tradePlanVersion.findMany({ where: { tradeId } });
      expect(versions.every((v) => v.locked)).toBe(true);
      const snap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect(snap.initialStop?.toNumber()).toBe(1890);

      await expect(confirmPlan(user.id, tradeId, 1885)).rejects.toThrow(/edit reason/i);
      const before = await prisma.tradePlanVersion.count({ where: { tradeId } });
      await savePlan(user.id, tradeId, {
        direction: "LONG",
        entry: 1900,
        stopLoss: 1885,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920 }],
        editReason: "Widened for news",
      });
      expect(await prisma.tradePlanVersion.count({ where: { tradeId } })).toBe(before + 1);
    });
  });

  it("moving the current stop never redefines 1R; partial exits settle Performance", async () => {
    const dateKey = "2026-09-07";
    const user = await readyUser("v3x-stops", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, tradeId, entry({ actualStopLoss: 1890 }));
      const locked = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });

      await updateTradeSections(user.id, tradeId, { actualStopLoss: 1900 }); // move to break-even
      const after = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect(after.initialStop?.toNumber()).toBe(1890);
      expect(after.riskAmount.toString()).toBe(locked.riskAmount.toString());
      expect(after.riskPercent.toString()).toBe(locked.riskPercent.toString());

      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 50, exitedAt: new Date() });
      expect((await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } })).settledAt).toBeNull();
      await upsertPartialExit(user.id, tradeId, { exitOrder: 2, exitPrice: 1920, percentClosed: 50, exitedAt: new Date() });
      const settled = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
      expect(settled.settledAt).not.toBeNull();
      expect(settled.realizedR?.toNumber()).toBe(1.5); // (1R × 50%) + (2R × 50%) against the ORIGINAL 10-point stop
    });
  });

  it("execution confirmations are re-scored against the frozen strategy snapshot", async () => {
    const dateKey = "2026-09-08";
    const user = await readyUser("v3x-exec", dateKey);
    const strategy = await prisma.strategy.create({ data: { userId: user.id, name: "S", applicableAssets: [] } });
    await prisma.strategyChecklistItem.createMany({
      data: [
        { userId: user.id, strategyId: strategy.id, kind: "EXECUTION", name: "Trigger candle", sortOrder: 0 },
        { userId: user.id, strategyId: strategy.id, kind: "EXECUTION", name: "Volume", sortOrder: 1 },
      ],
    });
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ strategyId: strategy.id }));
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).executionPercent).toBe(0);
      await updateExecutionConfirmations(user.id, tradeId, ["Trigger candle", "Trigger candle"]);
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(t.selectedExecution).toEqual(["Trigger candle"]);
      expect(t.executionPercent).toBe(50);
    });
  });
});

describe("Performance Account ledger ordering by real entry time", () => {
  it("orders by actual entry time even when ideas were created in the opposite order; frozen snapshots never move", async () => {
    const dateKey = "2026-09-09";
    const user = await readyUser("v3l-order", dateKey);
    await runLive(async () => {
      // A is created FIRST but executed LATER; B is created second, executed first and settles +2R.
      const a = await createQuickIdea(user.id, dateKey, idea({ nowMinutes: 420 }));
      const b = await createQuickIdea(user.id, dateKey, idea({ nowMinutes: 421 }));

      await recordFirstEntry(user.id, dateKey, b.tradeId, entry({ entryMinutes: 540, actualStopLoss: 1890 }));
      await upsertPartialExit(user.id, b.tradeId, { exitOrder: 1, exitPrice: 1920, percentClosed: 100, exitedAt: new Date() });
      const bSnap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: b.tradeId } });
      expect(bSnap.settledAt).not.toBeNull();

      await recordFirstEntry(user.id, dateKey, a.tradeId, entry({ entryMinutes: 600, actualStopLoss: 1890 }));
      const aSnap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: a.tradeId } });
      // B (09:00) is before A (10:00) → A risks against the balance AFTER B's profit.
      expect(aSnap.balanceBefore.toNumber()).toBe(bSnap.balanceBefore.toNumber() + bSnap.performancePnl!.toNumber());

      // Editing an entry time later never re-derives a frozen snapshot.
      await updateEntryTime(user.id, a.tradeId, 500);
      const aAfter = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: a.tradeId } });
      expect(aAfter.balanceBefore.toString()).toBe(aSnap.balanceBefore.toString());
      expect(aAfter.riskAmount.toString()).toBe(aSnap.riskAmount.toString());
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: a.tradeId } })).executionMinutes).toBe(500);
    });
  });

  it("an earlier real entry time excludes a later-settled trade from the balance basis", async () => {
    const dateKey = "2026-09-10";
    const user = await readyUser("v3l-earlier", dateKey);
    await runLive(async () => {
      const late = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, late.tradeId, entry({ entryMinutes: 700, actualStopLoss: 1890 }));
      await upsertPartialExit(user.id, late.tradeId, { exitOrder: 1, exitPrice: 1920, percentClosed: 100, exitedAt: new Date() });
      const lateSnap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: late.tradeId } });

      const early = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, early.tradeId, entry({ entryMinutes: 480, actualStopLoss: 1890 }));
      const earlySnap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: early.tradeId } });
      expect(earlySnap.balanceBefore.toString()).toBe(lateSnap.balanceBefore.toString()); // starting balance, not +PnL
    });
  });

  it("same entry minute ties break on trade number; historical 09:30 trades keep their time", async () => {
    const dateKey = "2026-09-11";
    const user = await readyUser("v3l-tie", dateKey);
    await runLive(async () => {
      // A Journal/extension-style trade with the legacy 09:30, entered via the plain section path.
      const legacy = await createTrade(
        user.id,
        dateKey,
        tradeSchema.parse({ assetSymbol: "XAUUSD", executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 }),
      );
      await updateTradeSections(user.id, legacy.id, { actualEntry: 1900, actualStopLoss: 1890 });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: legacy.id } })).executionMinutes).toBe(570);
      await upsertPartialExit(user.id, legacy.id, { exitOrder: 1, exitPrice: 1920, percentClosed: 100, exitedAt: new Date() });
      const legacySnap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: legacy.id } });

      // Same minute, higher trade number → ordered after the legacy trade.
      const v3 = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, v3.tradeId, entry({ entryMinutes: 570, actualStopLoss: 1890 }));
      const v3Snap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: v3.tradeId } });
      expect(v3Snap.balanceBefore.toNumber()).toBe(legacySnap.balanceBefore.toNumber() + legacySnap.performancePnl!.toNumber());
    });
  });

  it("creating an idea never writes a Performance risk override (allocation = account default)", async () => {
    const dateKey = "2026-09-12";
    const user = await readyUser("v3l-default", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea());
      const t = await getTrade(user.id, tradeId);
      const perf = t!.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE")!;
      const account = await prisma.tradingAccount.findFirstOrThrow({ where: { userId: user.id, kind: "PERFORMANCE" } });
      expect(perf.riskValue.toNumber()).toBe(account.defaultRiskPercent?.toNumber() ?? 1);
    });
  });
});

describe("Carried open positions", () => {
  it("lists earlier LIVE open positions only — never closed, never Backtesting — and keeps them manageable after archive", async () => {
    const user = await readyUser("v3c-carried", "2026-09-20");
    await runLive(async () => {
      const open = await createQuickIdea(user.id, "2026-09-20", idea());
      await recordFirstEntry(user.id, "2026-09-20", open.tradeId, entry({ actualStopLoss: 1890 }));
      await upsertPartialExit(user.id, open.tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 40, exitedAt: new Date() });

      const closed = await createQuickIdea(user.id, "2026-09-20", idea());
      await recordFirstEntry(user.id, "2026-09-20", closed.tradeId, entry({ actualStopLoss: 1890 }));
      await upsertPartialExit(user.id, closed.tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });

      const neverEntered = await createQuickIdea(user.id, "2026-09-20", idea());
      void neverEntered;
      await endDay(user.id, "2026-09-20");
    });

    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "Carry leak", assets: ["XAUUSD"], startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    await runInBacktestRun(user.id, run.id, async () => {
      const t = await createTrade(
        user.id,
        "2026-09-19",
        tradeSchema.parse({ assetSymbol: "XAUUSD", executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 }),
      );
      await updateTradeSections(user.id, t.id, { actualEntry: 1900, actualStopLoss: 1890 });
    });

    await runLive(async () => {
      const carried = await listCarriedOpenTrades(user.id, "2026-09-21");
      expect(carried.map((t) => t.assetSymbol)).toEqual(["XAUUSD"]);
      expect(carried).toHaveLength(1);
      const id = carried[0].id;
      // The day is archived and no review status was set — still manageable.
      expect(await tradeExecutionEditableGuard(user.id, "2026-09-20", id)).toBeNull();
      // Today's executed count never includes a carried position.
      const { usage } = await getDayLimitState(user.id, "2026-09-21");
      expect(usage.executedCount).toBe(0);
    });
  });
});

describe("tradeToFormValues — shared trade → form mapper", () => {
  it("carries setup validation and pre-trade mood so a Journal re-save can't clear them", async () => {
    const dateKey = "2026-09-13";
    const user = await readyUser("v3m-mapper", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(
        user.id,
        dateKey,
        idea({ preTradeMoodTags: ["PATIENT"], preTradeMoodIntensity: 2, preTradeMoodNote: "steady" }),
      );
      const values = tradeToFormValues((await getTrade(user.id, tradeId))!);
      expect(values).toMatchObject({
        preTradeMoodTags: ["PATIENT"],
        preTradeMoodIntensity: 2,
        preTradeMoodNote: "steady",
        setupTypeId: null,
        selectedSetupConditions: [],
      });
      expect(tradeSchema.safeParse(values).success).toBe(true);
    });
  });
});
