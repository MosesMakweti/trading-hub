import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { getTradingDay, getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { isDayEditable } from "@/domain/today/archive";
import * as svc from "@/server/services/close-day.service";
import * as behaviourSvc from "@/server/services/behaviour-labels.service";
import { tradeExecutionEditableGuard } from "@/actions/day-guard";
import type { TradeInput } from "@/lib/validation/trades";

/** Close Trading Day (Stage 8) — real integration tests against the dev
 *  Postgres DB, same pattern as trade-review.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `close-day-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

describe("Close Trading Day — a normal, fully-complete day", () => {
  it("reconciles FULLY_CLOSED trades, archives the day, and persists the reflection", async () => {
    const user = await makeUser("fully-complete");
    const dateKey = "2026-01-05";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const before = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(before.status).toBe("CLOSED");
    expect(before.closedAt).not.toBeNull();
    expect(before.actualRR?.toNumber()).toBeCloseTo(2, 4);

    await svc.closeTradingDay(user.id, dateKey, {
      dayWentWell: "Followed the plan.",
      dayToImprove: null,
      dayMainLesson: "Patience pays.",
      dayCarryForward: null,
    });

    const day = await getTradingDay(user.id, dateKey);
    expect(day?.status).toBe("ARCHIVED");
    expect(isDayEditable(day)).toBe(false);
    expect(day?.dayWentWell).toBe("Followed the plan.");
    expect(day?.dayMainLesson).toBe("Patience pays.");
  });
});

describe("Close Trading Day — open positions are preserved, never falsely closed", () => {
  it("a partially closed trade stays open (no fake closedAt) after the day closes", async () => {
    const user = await makeUser("partial-day");
    const dateKey = "2026-01-06";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    await upsertPartialExit(user.id, trade.id, { exitOrder: 1, exitPrice: 1910, percentClosed: 50, exitedAt: new Date() });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "PARTIALLY_CLOSED" });

    await svc.closeTradingDay(user.id, dateKey, {});

    const day = await getTradingDay(user.id, dateKey);
    expect(day?.status).toBe("ARCHIVED");
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.status).toBe("OPEN");
    expect(reloaded.closedAt).toBeNull();
    expect(reloaded.actualRR).toBeNull();
    expect(reloaded.tradeDate.toISOString().slice(0, 10)).toBe(dateKey); // stays attached to the original day
  });

  it("a still-holding trade stays open after the day closes", async () => {
    const user = await makeUser("holding-day");
    const dateKey = "2026-01-07";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "STILL_HOLDING" });

    await svc.closeTradingDay(user.id, dateKey, {});

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.status).toBe("OPEN");
    expect(reloaded.closedAt).toBeNull();
  });

  it("a carried-open trade can still be updated after its day is archived, narrowly, without reopening the day", async () => {
    const user = await makeUser("carried-trade");
    const dateKey = "2026-01-08";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "STILL_HOLDING" });
    await svc.closeTradingDay(user.id, dateKey, {});

    // The day is archived, but the carried-open trade's own execution fields
    // remain editable — narrowly, not the whole day.
    const guardResult = await tradeExecutionEditableGuard(user.id, dateKey, trade.id);
    expect(guardResult).toBeNull();
    await updateTradeSections(user.id, trade.id, { executionNotes: "Still running into next session." });
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.executionNotes).toBe("Still running into next session.");
    expect(reloaded.tradeDate.toISOString().slice(0, 10)).toBe(dateKey);

    // A trade with no such carve-out (e.g. never reviewed) stays blocked.
    const otherTrade = await createTrade(user.id, dateKey, minimalTradeInput());
    const blocked = await tradeExecutionEditableGuard(user.id, dateKey, otherTrade.id);
    expect(blocked?.success).toBe(false);
  });
});

describe("Close Trading Day — cancelled / never-triggered ideas", () => {
  it("never receives a fake realized R or PnL and is excluded from win/loss counts", async () => {
    const user = await makeUser("cancelled-day");
    const dateKey = "2026-01-09";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: null,
      entry: 1900,
      stopLoss: 1890,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
    });
    await setReviewLifecycleStatus(user.id, trade.id, {
      status: "CANCELLED_NEVER_TRIGGERED",
      cancellationReason: "Price ran away before entry.",
    });

    const summary = await svc.getDayCloseSummary(user.id, dateKey);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.wins + summary.losses + summary.breakevens).toBe(0);
    expect(summary.totalRealizedRSoFar).toBe(0);
    expect(summary.totalPnl).toBe(0);

    await svc.closeTradingDay(user.id, dateKey, {});
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.actualEntry).toBeNull();
    expect(reloaded.actualRR).toBeNull();
    expect(reloaded.status).toBe("OPEN"); // never forced into a closed/win-loss state
    // The plan itself survives — a cancelled idea stays historically useful.
    const planVersion = await prisma.tradePlanVersion.findFirst({ where: { tradeId: trade.id } });
    expect(planVersion?.entry?.toNumber()).toBe(1900);
  });
});

describe("Day summary calculations (Stage 8 §8/§9)", () => {
  it("counts trades, realized R, PnL, wins/losses, overrides, and behaviour labels correctly", async () => {
    const user = await makeUser("summary-math");
    const dateKey = "2026-01-10";

    const winner = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 }); // +2R
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });

    const loser = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, loser.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1890 }); // -1R
    await setReviewLifecycleStatus(user.id, loser.id, { status: "FULLY_CLOSED" });

    const cancelled = await createTrade(user.id, dateKey, minimalTradeInput());
    await setReviewLifecycleStatus(user.id, cancelled.id, { status: "CANCELLED_NEVER_TRIGGERED" });

    const labels = await behaviourSvc.listBehaviourLabels(user.id);
    const followedPlan = labels.find((l) => l.name === "Followed trading plan")!;
    const fomo = labels.find((l) => l.name === "FOMO trade")!;
    await behaviourSvc.setTradeBehaviourLabels(user.id, winner.id, [followedPlan.id]);
    await behaviourSvc.setTradeBehaviourLabels(user.id, loser.id, [followedPlan.id, fomo.id]);

    const summary = await svc.getDayCloseSummary(user.id, dateKey);
    expect(summary.tradeCount).toBe(3);
    expect(summary.fullyClosedCount).toBe(2);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.totalRealizedRSoFar).toBeCloseTo(1, 4); // +2 + -1
    expect(summary.totalPnl).not.toBe(0);

    const followedPlanCount = summary.behaviourLabels.find((l) => l.id === followedPlan.id)?.count;
    const fomoCount = summary.behaviourLabels.find((l) => l.id === fomo.id)?.count;
    expect(followedPlanCount).toBe(2);
    expect(fomoCount).toBe(1);
  });

  it("warns about unresolved/contradictory trades without blocking or corrupting data", async () => {
    const user = await makeUser("warnings");
    const dateKey = "2026-01-11";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900 }); // executed, but no review status set

    const summary = await svc.getDayCloseSummary(user.id, dateKey);
    expect(summary.unresolvedCount).toBe(1);
    expect(summary.warnings.length).toBeGreaterThan(0);

    // Closing anyway must not corrupt anything — the trade is left exactly as it was.
    await svc.closeTradingDay(user.id, dateKey, {});
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.actualEntry?.toNumber()).toBe(1900);
    expect(reloaded.reviewLifecycleStatus).toBeNull();
    const day = await getTradingDay(user.id, dateKey);
    expect(day?.status).toBe("ARCHIVED");
  });
});

describe("Frozen snapshots remain unchanged by Close Day", () => {
  it("setup validation / plan snapshots are untouched by closeTradingDay", async () => {
    const user = await makeUser("snapshots-close-day");
    const dateKey = "2026-01-12";
    const trade = await createTrade(user.id, dateKey, minimalTradeInput());
    await savePlan(user.id, trade.id, {
      direction: "LONG",
      timeframe: null,
      entry: 1900,
      stopLoss: 1890,
      targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
    });
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const before = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const planBefore = await prisma.tradePlanVersion.findFirst({ where: { tradeId: trade.id }, orderBy: { versionNumber: "desc" } });

    await svc.closeTradingDay(user.id, dateKey, { dayMainLesson: "Test." });

    const after = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const planAfter = await prisma.tradePlanVersion.findFirst({ where: { tradeId: trade.id }, orderBy: { versionNumber: "desc" } });
    expect(after.strategyExecutionSnapshot).toEqual(before.strategyExecutionSnapshot);
    expect(planAfter?.id).toBe(planBefore?.id);
    expect(planAfter?.entry?.toString()).toBe(planBefore?.entry?.toString());
  });
});

describe("getOrCreateTradingDay reuse sanity", () => {
  it("closeTradingDay works even when no TradingDay row exists yet", async () => {
    const user = await makeUser("no-day-row");
    const dateKey = "2026-01-13";
    await createTrade(user.id, dateKey, minimalTradeInput());
    expect(await getTradingDay(user.id, dateKey)).toBeNull();

    await svc.closeTradingDay(user.id, dateKey, { dayWentWell: "First trade of the new setup." });
    const day = await getOrCreateTradingDay(user.id, dateKey);
    expect(day.status).toBe("ARCHIVED");
    expect(day.dayWentWell).toBe("First trade of the new setup.");
  });
});
