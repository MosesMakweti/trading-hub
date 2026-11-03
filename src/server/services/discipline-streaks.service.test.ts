import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { dateKeyToUtcDate } from "@/lib/date";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun } from "@/server/services/backtest-run.service";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { createQuickIdea, recordFirstEntry } from "@/server/services/today-trade.service";
import { completeReview, setReviewTradeIntent, updateReviewFields } from "@/server/services/trade-review-v3.service";
import {
  acknowledgeAchievements,
  computeDiscipline,
  getDisciplineOverview,
  reviewFeedback,
  routineFeedback,
} from "@/server/services/discipline-streaks.service";

/**
 * Discipline Streaks — integration tests against the test Postgres DB.
 * History is inserted directly (TradingDay / Trade rows exactly as the app
 * writes them) and `now` is injected, so every scenario is deterministic.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string, createdAt = new Date("2026-02-01T00:00:00Z")) {
  const u = await createTestUser(`disc-${label}`);
  userIds.push(u.id);
  await prisma.user.update({ where: { id: u.id }, data: { createdAt } });
  return u;
}

/** A LIVE TradingDay as the routine + close flows leave it. */
async function routineDay(
  userId: string,
  dateKey: string,
  o: { ready?: string | null; closed?: string | null; reflection?: boolean } = {},
) {
  const ready = o.ready === undefined ? `${dateKey}T07:30:00Z` : o.ready;
  const closed = o.closed === undefined ? `${dateKey}T21:00:00Z` : o.closed;
  return prisma.tradingDay.create({
    data: {
      userId,
      date: dateKeyToUtcDate(dateKey),
      routineReadyAt: ready ? new Date(ready) : null,
      routineFirstReadyAt: ready ? new Date(ready) : null,
      analyzedAt: closed ? new Date(closed) : null,
      status: closed ? "ARCHIVED" : "ACTIVE",
      dayMainLesson: o.reflection === false ? null : "Waited for my levels.",
    },
  });
}

const ALL_YES = { followedStrategy: true, followedEntryModel: true, followedTradeManagement: true, remainedPatient: true };

/** A closed LIVE trade; `reviewedAt` set → final review complete (all structured answers present). */
async function trade(
  userId: string,
  dateKey: string,
  o: {
    reviewedAt?: string | null;
    win?: boolean;
    intent?: "PLANNED" | "FOMO" | "REVENGE";
    answers?: Record<string, boolean>;
    limitOverride?: boolean;
    open?: boolean;
    backtestRunId?: string;
  } = {},
) {
  const closedAt = new Date(`${dateKey}T15:00:00Z`);
  const reviewedAt = o.reviewedAt === undefined ? `${dateKey}T18:00:00Z` : o.reviewedAt;
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: dateKeyToUtcDate(dateKey),
      executionMinutes: 600,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 60,
      assetSymbol: "XAUUSD",
      actualEntry: new Prisma.Decimal(100),
      actualStopLoss: new Prisma.Decimal(95),
      actualExit: o.open ? null : new Prisma.Decimal(o.win === false ? 95 : 110),
      closedAt: o.open ? null : closedAt,
      reviewedAt: reviewedAt ? new Date(reviewedAt) : null,
      finalReviewCreditedAt: reviewedAt ? new Date(reviewedAt) : null,
      tradeIntent: o.intent ?? "PLANNED",
      adherenceAnswers: o.answers ?? ALL_YES,
      wouldTakeAgain: true,
      limitOverrideReason: o.limitOverride ? "Felt strong" : null,
      status: reviewedAt ? "REVIEWED" : "CLOSED",
      backtestRunId: o.backtestRunId ?? null,
    },
  });
}

const FRIDAY_EVENING = new Date("2026-03-06T20:00:00Z");

describe("🔥 routine streak", () => {
  it("counts consecutive full routine days, breaks on an incomplete one, and keeps today pending", async () => {
    const u = await user("routine");
    await routineDay(u.id, "2026-03-02"); // Mon ✓
    await routineDay(u.id, "2026-03-03"); // Tue ✓
    await routineDay(u.id, "2026-03-04", { closed: null }); // Wed — pre-session only → incomplete
    await routineDay(u.id, "2026-03-05"); // Thu ✓
    await routineDay(u.id, "2026-03-06", { closed: null }); // Fri (today) — not closed yet

    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.routine).toMatchObject({ current: 1, longest: 2, total: 3, todayStatus: "PENDING", creditedToday: false });
    expect(o.tracks.routine.lastBreak).toEqual({ dateKey: "2026-03-04", endedLength: 2 });
    expect(o.today).toMatchObject({ requirement: "REQUIRED", routinePreSession: true, routinePostSession: false });
    // "First Steps" unlocked, dated by the first full day.
    const first = o.achievements.find((a) => a.key === "routine.first")!;
    expect(first).toMatchObject({ unlocked: true, achievedOn: "2026-03-02", isNew: true });
  });

  it("closing without any written reflection, or a day readied late, is not a full routine", async () => {
    const u = await user("routine-partial");
    await routineDay(u.id, "2026-03-02", { reflection: false });
    await routineDay(u.id, "2026-03-03", { ready: "2026-03-05T09:00:00Z" }); // back-filled two days later
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.routine.total).toBe(0);
  });

  it("never requires a trade: flat days build the routine streak", async () => {
    const u = await user("routine-flat");
    for (const k of ["2026-03-02", "2026-03-03", "2026-03-04"]) await routineDay(u.id, k);
    const o = await getDisciplineOverview(u.id, new Date("2026-03-04T22:00:00Z"));
    expect(o.tracks.routine).toMatchObject({ current: 3, creditedToday: true, milestoneReached: 3 });
    expect(o.tracks.adherence.total).toBe(0);
  });

  it("follows the trader timezone: a 23:30 New York readiness belongs to that local date", async () => {
    const u = await user("routine-tz");
    await prisma.traderTimezoneVersion.create({
      data: { userId: u.id, timezone: "America/New_York", effectiveFrom: new Date("2026-01-01T05:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    // Monday local: readied 23:30 NY (= Tue 04:30 UTC), closed 23:50 NY.
    await routineDay(u.id, "2026-03-02", { ready: "2026-03-03T04:30:00Z", closed: "2026-03-03T04:50:00Z" });
    const o = await getDisciplineOverview(u.id, new Date("2026-03-03T05:00:00Z")); // still Mon in NY
    expect(o.todayKey).toBe("2026-03-03"); // 00:00 NY Tuesday
    expect(o.tracks.routine.total).toBe(1);
    expect(o.calendar.find((d) => d.dateKey === "2026-03-02")?.routine).toBe("ACTIVE");
  });
});

describe("📝 review streak", () => {
  it("many reviews on one day add to the count but only once to the streak; profit is irrelevant", async () => {
    const u = await user("reviews");
    await trade(u.id, "2026-03-02", { win: true });
    await trade(u.id, "2026-03-02", { win: false });
    await trade(u.id, "2026-03-02", { win: false });
    await trade(u.id, "2026-03-03", { win: false });
    const o = await getDisciplineOverview(u.id, new Date("2026-03-03T20:00:00Z"));
    expect(o.tracks.review).toMatchObject({ total: 4, current: 2, activeDays: 2 });
    expect(o.calendar.find((d) => d.dateKey === "2026-03-02")?.reviewsCompleted).toBe(3);
  });

  it("breaks only on a required day when a closed trade was left unreviewed", async () => {
    const u = await user("review-break");
    await trade(u.id, "2026-03-02");
    await trade(u.id, "2026-03-03", { reviewedAt: null }); // closed Tue, never reviewed
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.review).toMatchObject({ current: 0, longest: 1, total: 1 });
    expect(o.calendar.find((d) => d.dateKey === "2026-03-03")?.review).toBe("MISSED");
  });

  it("an interim (still-open) review or a trade without structured answers earns no credit", async () => {
    const u = await user("review-incomplete");
    await trade(u.id, "2026-03-02", { open: true }); // interim review on an open position
    const t = await trade(u.id, "2026-03-02");
    await prisma.trade.update({ where: { id: t.id }, data: { wouldTakeAgain: null } }); // missing a requirement
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.review.total).toBe(0);
  });
});

describe("🎯 plan adherence streak", () => {
  it("credits a losing trade that followed the plan and rejects a winning trade that broke it", async () => {
    const u = await user("adherence");
    const loser = await trade(u.id, "2026-03-02", { win: false }); // followed the plan, lost
    const fomoWinner = await trade(u.id, "2026-03-03", { win: true, intent: "FOMO" });
    const overLimitWinner = await trade(u.id, "2026-03-04", { win: true, limitOverride: true });
    const impatientWinner = await trade(u.id, "2026-03-05", { win: true, answers: { ...ALL_YES, remainedPatient: false } });
    const c = await computeDiscipline(u.id, FRIDAY_EVENING);
    expect(c.adherence.get(loser.id)?.status).toBe("PERFECT");
    for (const t of [fomoWinner, overLimitWinner, impatientWinner]) expect(c.adherence.get(t.id)?.status).toBe("VIOLATED");
    expect(c.totals.adherence).toBe(1);
    expect(c.streaks.adherence).toMatchObject({ current: 0, longest: 1 });
    // Every one of them was still properly reviewed: review credit is independent of adherence.
    expect(c.totals.review).toBe(4);
  });

  it("multiple perfect trades on one day count individually but once towards the streak; no-trade days don't break it", async () => {
    const u = await user("adherence-many");
    await trade(u.id, "2026-03-02");
    await trade(u.id, "2026-03-02");
    // Tue–Wed: no trades (rest).
    await trade(u.id, "2026-03-05");
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.adherence).toMatchObject({ total: 3, current: 2, activeDays: 2 });
    expect(o.calendar.find((d) => d.dateKey === "2026-03-03")?.adherence).toBe("REST");
  });

  it("an executed trade awaiting its review is pending, not credited", async () => {
    const u = await user("adherence-pending");
    await trade(u.id, "2026-03-05", { reviewedAt: null });
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.adherence.total).toBe(0);
    expect(o.adherencePendingDays).toBe(1);
  });
});

describe("data integrity", () => {
  it("historical corrections recalculate streaks, while unlocked achievements are preserved", async () => {
    const u = await user("corrections");
    const t = await trade(u.id, "2026-03-02");
    let o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.review.total).toBe(1);
    expect(o.achievements.find((a) => a.key === "review.first")?.unlocked).toBe(true);

    // The trader corrects the review (a process answer flips to No) → no longer perfect.
    await prisma.trade.update({ where: { id: t.id }, data: { adherenceAnswers: { ...ALL_YES, followedStrategy: false } } });
    o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.adherence.total).toBe(0);
    expect(o.achievements.find((a) => a.key === "adherence.first")?.unlocked).toBe(true); // earned before, kept

    // Deleting the trade removes its credits from every total and streak…
    await prisma.trade.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
    o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.tracks.review.total).toBe(0);
    // …but the historical achievement record survives.
    expect(o.achievements.find((a) => a.key === "review.first")).toMatchObject({ unlocked: true, achievedOn: "2026-03-02" });
  });

  it("concurrent loads unlock each achievement exactly once", async () => {
    const u = await user("concurrency");
    await routineDay(u.id, "2026-03-02");
    await Promise.all(Array.from({ length: 6 }, () => getDisciplineOverview(u.id, FRIDAY_EVENING)));
    expect(await prisma.disciplineAchievement.count({ where: { userId: u.id, key: "routine.first" } })).toBe(1);
  });

  it("achievements are append-only: no rewrite, no delete, seenAt written once", async () => {
    const u = await user("immutable");
    await routineDay(u.id, "2026-03-02");
    await getDisciplineOverview(u.id, FRIDAY_EVENING);
    const row = await prisma.disciplineAchievement.findFirstOrThrow({ where: { userId: u.id } });
    await expect(prisma.disciplineAchievement.update({ where: { id: row.id }, data: { achievedOn: new Date("2026-01-01") } })).rejects.toThrow(/DISCIPLINE_IMMUTABLE/);
    await expect(prisma.disciplineAchievement.delete({ where: { id: row.id } })).rejects.toThrow(/DISCIPLINE_IMMUTABLE/);
    expect(await acknowledgeAchievements(u.id, null)).toBe(1);
    expect(await acknowledgeAchievements(u.id, null)).toBe(0);
    const o = await getDisciplineOverview(u.id, FRIDAY_EVENING);
    expect(o.achievements.find((a) => a.key === "routine.first")?.isNew).toBe(false);
  });

  it("isolates users and excludes Backtesting trades", async () => {
    const a = await user("iso-a");
    const b = await user("iso-b");
    await trade(a.id, "2026-03-02");
    await routineDay(a.id, "2026-03-02");
    const run = await createBacktestRun(
      b.id,
      createBacktestRunSchema.parse({ name: "Iso", assets: ["XAUUSD"], startDate: "2026-02-01", endDate: "2026-02-28" }),
    );
    await trade(b.id, "2026-02-10", { backtestRunId: run.id }); // a perfect, reviewed SIMULATED trade

    const ob = await getDisciplineOverview(b.id, FRIDAY_EVENING);
    expect(ob.tracks.review.total).toBe(0);
    expect(ob.tracks.routine.total).toBe(0);
    expect(ob.achievements.every((x) => !x.unlocked)).toBe(true);
    // Acknowledging with another user's id touches nothing of A's.
    await acknowledgeAchievements(b.id, null);
    const oa = await getDisciplineOverview(a.id, FRIDAY_EVENING);
    expect(oa.achievements.filter((x) => x.isNew).length).toBeGreaterThan(0);
  });
});

describe("real review flow → credit", () => {
  const idea = () => quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 615 });

  it("completing a final review stamps a write-once credit; re-completing never moves or duplicates it", async () => {
    const dateKey = "2026-08-03";
    const u = await user("flow", new Date("2026-08-01T00:00:00Z"));
    const section = await prisma.routineSection.create({ data: { userId: u.id, title: "Prep", sortOrder: 0 } });
    await prisma.routineItem.create({ data: { userId: u.id, sectionId: section.id, label: "Bias", type: "CHECKBOX", isMandatory: false, sortOrder: 0 } });

    await runLive(async () => {
      const day = await getOrCreateTradingDay(u.id, dateKey);
      await getOrCreateDayRoutine(u.id, day);
      await setRoutineReady(u.id, dateKey, true);
      const { tradeId } = await createQuickIdea(u.id, dateKey, idea());
      await savePlan(u.id, tradeId, {
        direction: "LONG",
        timeframe: "15m",
        entry: 1900,
        stopLoss: 1890,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 100 }],
      });
      await recordFirstEntry(u.id, dateKey, tradeId, recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600 }));
      // Stopped out for a loss — the review still earns full credit.
      await upsertPartialExit(u.id, tradeId, { exitOrder: 1, exitPrice: 1890, percentClosed: 100, exitedAt: new Date() });
      await setReviewTradeIntent(u.id, tradeId, "PLANNED");
      await updateReviewFields(u.id, tradeId, { adherenceAnswers: ALL_YES, wouldTakeAgain: true });

      expect((await completeReview(u.id, tradeId)).mode).toBe("FINAL");
      const first = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(first.finalReviewCreditedAt).not.toBeNull();

      const fb = await reviewFeedback(u.id, tradeId);
      expect(fb?.review).toMatchObject({ counted: true, totalReviewed: 1 });
      expect(fb?.adherence?.perfect).toBe(true);
      expect(fb?.newAchievements.map((x) => x.key)).toEqual(expect.arrayContaining(["review.first", "adherence.first"]));

      // Duplicate submit.
      await new Promise((r) => setTimeout(r, 20));
      await completeReview(u.id, tradeId);
      const second = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(second.reviewedAt!.getTime()).toBeGreaterThan(first.reviewedAt!.getTime());
      expect(second.finalReviewCreditedAt!.getTime()).toBe(first.finalReviewCreditedAt!.getTime());
      const again = await reviewFeedback(u.id, tradeId);
      expect(again?.review?.totalReviewed).toBe(1);
      expect(again?.newAchievements).toEqual([]);

      // DB backstop.
      await expect(prisma.trade.update({ where: { id: tradeId }, data: { finalReviewCreditedAt: new Date() } })).rejects.toThrow(/write-once/);

      // Routine feedback: readied, not closed yet → not complete.
      const rf = await routineFeedback(u.id, dateKey);
      expect(rf?.routine?.complete).toBe(false);
    });
  });
});
