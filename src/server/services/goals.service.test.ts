import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import {
  GOAL_PAUSE_LIMIT_DAYS,
  GoalError,
  abandonGoal,
  createGoal,
  getGoalsOverview,
  getProgressSummary,
  pauseGoal,
  processGoalProgress,
  resumeGoal,
  setGoalCheckIn,
  updateGoal,
} from "@/server/services/goals.service";
import type { CreateGoalInput } from "@/lib/validation/goals";

/**
 * Goals — integration tests against the test Postgres DB. Activity history
 * is inserted directly (as the app writes it) and `now` is injected, so
 * every scenario is deterministic. Users have no timezone row (→ UTC)
 * unless a test sets one.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`goals-${label}`);
  userIds.push(u.id);
  await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  return u;
}

// 2026-03-02 is a Monday.
const MON = "2026-03-02";
const at = (dateKey: string, time = "12:00:00") => new Date(`${dateKey}T${time}Z`);

/** Weekday trading dates from `from`, `n` of them. */
function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let k = from; out.length < n; k = addDaysToDateKey(k, 1)) {
    const dow = new Date(`${k}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(k);
  }
  return out;
}

/** A day whose pre-session routine was confirmed (and closed with a reflection). */
async function readyDay(userId: string, dateKey: string, readyAt = at(dateKey, "07:30:00")) {
  await prisma.tradingDay.create({
    data: {
      userId,
      date: dateKeyToUtcDate(dateKey),
      routineReadyAt: readyAt,
      routineFirstReadyAt: readyAt,
      analyzedAt: at(dateKey, "21:00:00"),
      status: "ARCHIVED",
      dayMainLesson: "Waited for my levels.",
    },
  });
}

const routineGoal = (o: Partial<CreateGoalInput> = {}): CreateGoalInput => ({
  name: "Prepare every session",
  description: null,
  category: "ROUTINE",
  targetDays: 30,
  startDate: MON,
  requirements: [{ type: "PRE_SESSION_ROUTINE", label: null, mandatory: true }],
  ...o,
});

async function expectGoalError(p: Promise<unknown>, code: GoalError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof GoalError && e.code === code);
}

describe("creating goals", () => {
  it("creates a 7-day goal", async () => {
    const u = await user("create7");
    const { id } = await createGoal(u.id, routineGoal({ targetDays: 7 }), at(MON, "06:00:00"));
    const o = await getGoalsOverview(u.id, at(MON, "06:00:00"));
    expect(o.active).toMatchObject({ id, targetDays: 7, currentStreak: 0, progressPercent: 0, remainingDays: 7, status: "ACTIVE", started: true });
    expect(o.active?.requirements.map((r) => r.type)).toEqual(["PRE_SESSION_ROUTINE"]);
  });

  it("creates a 30-day goal and projects its finish over trading days", async () => {
    const u = await user("create30");
    await createGoal(u.id, routineGoal({ targetDays: 30 }), at(MON, "06:00:00"));
    const o = await getGoalsOverview(u.id, at(MON, "06:00:00"));
    expect(o.active?.targetDays).toBe(30);
    // 30 weekdays from Monday 2 March (today not yet qualified) end on Friday 10 April.
    expect(o.active?.projectedCompletion).toBe("2026-04-10");
  });

  it("refuses a second open goal", async () => {
    const u = await user("second");
    await createGoal(u.id, routineGoal(), at(MON));
    await expectGoalError(createGoal(u.id, routineGoal({ name: "Another" }), at(MON)), "OPEN_GOAL_EXISTS");
  });

  it("lets exactly one of many concurrent creations through", async () => {
    const u = await user("race");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => createGoal(u.id, routineGoal({ name: `Goal ${i}` }), at(MON))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.goal.count({ where: { userId: u.id } })).toBe(1);
  });

  it("the database itself rejects a second open goal", async () => {
    const u = await user("db-guard");
    await createGoal(u.id, routineGoal(), at(MON));
    await expect(
      prisma.goal.create({ data: { userId: u.id, name: "Sneaky", category: "OTHER", targetDays: 7, startDate: dateKeyToUtcDate(MON) } }),
    ).rejects.toSatisfy((e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
  });

  it("refuses back-dating, far-future starts and requirement sets that ask nothing on quiet days", async () => {
    const u = await user("invalid");
    await expectGoalError(createGoal(u.id, routineGoal({ startDate: "2026-03-01" }), at(MON)), "INVALID");
    await expectGoalError(createGoal(u.id, routineGoal({ startDate: "2026-05-01" }), at(MON)), "INVALID");
    await expectGoalError(
      createGoal(u.id, routineGoal({ requirements: [{ type: "FOLLOW_PLAN", label: null, mandatory: true }] }), at(MON)),
      "INVALID",
    );
  });
});

describe("consecutive progress", () => {
  it("12 days, a miss, 5 more → 17 successful, current 5, longest 12, progress 5/30; finalized days are stored", async () => {
    const u = await user("12-5");
    await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    const days = tradingDays(MON, 18);
    for (const d of [...days.slice(0, 12), ...days.slice(13)]) await readyDay(u.id, d);
    const now = at(addDaysToDateKey(days[17], 1)); // the day after the 18th trading day (Wed 25 → Thu 26 Mar)
    const o = await getGoalsOverview(u.id, now);
    expect(o.active).toMatchObject({ currentStreak: 5, longestStreak: 12, successfulDays: 17, missedDays: 1, attempt: 2, progressPercent: 17, remainingDays: 25 });
    expect(o.active?.attemptStartedOn).toBe(days[13]);
    expect(o.stats).toMatchObject({ current: 5, longest: 12, successfulDays: 17 });

    const stored = await prisma.goalDay.findMany({ where: { userId: u.id }, orderBy: { date: "asc" } });
    expect(stored.map((d) => utcDateToKey(d.date))).toEqual(
      Array.from({ length: 24 }, (_, i) => addDaysToDateKey(MON, i)), // Mon 2 … Wed 25 Mar: every past day
    );
    expect(stored.find((d) => utcDateToKey(d.date) === days[12])).toMatchObject({ status: "MISSED", streakAfter: 0, attempt: 1 });
    expect(stored.filter((d) => d.status === "REST")).toHaveLength(6); // three weekends
  });

  it("stored days never change, even if the records behind them are deleted", async () => {
    const u = await user("immutable");
    await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    await readyDay(u.id, MON);
    await processGoalProgress(u.id, at("2026-03-03"));
    await prisma.tradingDay.deleteMany({ where: { userId: u.id } });
    const o = await getGoalsOverview(u.id, at("2026-03-03"));
    expect(o.active?.successfulDays).toBe(1);
    const day = await prisma.goalDay.findFirstOrThrow({ where: { userId: u.id } });
    await expect(prisma.goalDay.update({ where: { id: day.id }, data: { streakAfter: 9 } })).rejects.toThrow(/GOAL_IMMUTABLE/);
    await expect(prisma.goalDay.delete({ where: { id: day.id } })).rejects.toThrow(/GOAL_IMMUTABLE/);
  });

  it("processing twice changes nothing", async () => {
    const u = await user("idempotent");
    await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    for (const d of tradingDays(MON, 3)) await readyDay(u.id, d);
    const now = at("2026-03-05");
    await Promise.all([processGoalProgress(u.id, now), processGoalProgress(u.id, now), processGoalProgress(u.id, now)]);
    expect(await prisma.goalDay.count({ where: { userId: u.id } })).toBe(3);
  });

  it("completes the goal on the final day that reaches the target, then allows a new goal", async () => {
    const u = await user("complete");
    await createGoal(u.id, routineGoal({ targetDays: 7 }), at(MON, "06:00:00"));
    const days = tradingDays(MON, 7);
    for (const d of days) await readyDay(u.id, d);
    // On the 7th day itself the streak is 7 but the day is not final yet.
    const sameDay = await getGoalsOverview(u.id, at(days[6], "22:00:00"));
    expect(sameDay.active).toMatchObject({ currentStreak: 7, status: "ACTIVE" });
    // Next morning it is final → completed.
    const o = await getGoalsOverview(u.id, at(addDaysToDateKey(days[6], 3)));
    expect(o.active).toBeNull();
    expect(o.history[0]).toMatchObject({ status: "COMPLETED", endedOn: days[6], successfulDays: 7, longestStreak: 7, attempts: 1 });
    expect(o.stats).toMatchObject({ goalsCompleted: 1, longest: 7 });
    const g = await prisma.goal.findFirstOrThrow({ where: { userId: u.id } });
    await expect(prisma.goal.update({ where: { id: g.id }, data: { status: "ACTIVE" } })).rejects.toThrow(/GOAL_IMMUTABLE/);
    await createGoal(u.id, routineGoal({ name: "Next", startDate: addDaysToDateKey(days[6], 3) }), at(addDaysToDateKey(days[6], 3)));
  });

  it("uses the trader's timezone for 'today' and for activity dates", async () => {
    const u = await user("tz");
    await prisma.traderTimezoneVersion.create({ data: { userId: u.id, timezone: "Pacific/Auckland", effectiveFrom: new Date("2020-01-01T00:00:00Z") } });
    // 11:30 UTC on Tue 3 Mar is 00:30 on Wed 4 Mar in Auckland (UTC+13).
    const now = new Date("2026-03-03T11:30:00Z");
    await expectGoalError(createGoal(u.id, routineGoal({ startDate: "2026-03-03" }), now), "INVALID"); // already yesterday there
    await createGoal(u.id, routineGoal({ startDate: "2026-03-04" }), now);
    // Readiness at 20:00 UTC Tue = 09:00 Wed in Auckland → credits Wednesday.
    await readyDay(u.id, "2026-03-04", new Date("2026-03-03T20:00:00Z"));
    const o = await getGoalsOverview(u.id, new Date("2026-03-04T11:30:00Z")); // 00:30 Thu in Auckland
    expect(o.todayKey).toBe("2026-03-05");
    expect(o.active?.days.find((d) => d.dateKey === "2026-03-04")).toMatchObject({ status: "QUALIFIED", final: true });
  });
});

describe("lifecycle", () => {
  it("a paused goal still blocks a new one; paused days freeze the streak; resuming continues it", async () => {
    const u = await user("pause");
    const { id } = await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    await readyDay(u.id, MON);
    await readyDay(u.id, "2026-03-03");
    await pauseGoal(u.id, id, at("2026-03-04", "06:00:00"));
    await expectGoalError(createGoal(u.id, routineGoal({ name: "Other", startDate: "2026-03-04" }), at("2026-03-04")), "OPEN_GOAL_EXISTS");
    await resumeGoal(u.id, id, at("2026-03-06", "06:00:00"));
    await readyDay(u.id, "2026-03-06");
    const o = await getGoalsOverview(u.id, at("2026-03-07"));
    expect(o.active?.days.filter((d) => d.status === "PAUSED").map((d) => d.dateKey)).toEqual(["2026-03-04", "2026-03-05"]);
    expect(o.active).toMatchObject({ currentStreak: 3, attempt: 1, status: "ACTIVE" });
    expect(o.active?.pause).toMatchObject({ daysUsed: 2, daysLeft: GOAL_PAUSE_LIMIT_DAYS - 2 });
  });

  it("a pause ends by itself once the allowance is used", async () => {
    const u = await user("pause-cap");
    const { id } = await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    await pauseGoal(u.id, id, at(MON, "08:00:00"));
    const o = await getGoalsOverview(u.id, at("2026-03-12"));
    expect(o.active?.status).toBe("ACTIVE");
    const paused = o.active?.days.filter((d) => d.status === "PAUSED").map((d) => d.dateKey);
    expect(paused).toEqual(Array.from({ length: GOAL_PAUSE_LIMIT_DAYS }, (_, i) => addDaysToDateKey(MON, i)));
    await expectGoalError(pauseGoal(u.id, id, at("2026-03-12")), "INVALID");
  });

  it("abandoning keeps the history and frees the slot", async () => {
    const u = await user("abandon");
    const { id } = await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    for (const d of tradingDays(MON, 3)) await readyDay(u.id, d);
    await abandonGoal(u.id, id, at("2026-03-05"));
    const o = await getGoalsOverview(u.id, at("2026-03-05"));
    expect(o.active).toBeNull();
    expect(o.history[0]).toMatchObject({ status: "ABANDONED", successfulDays: 3, endedOn: "2026-03-05" });
    expect(o.stats).toMatchObject({ goalsAbandoned: 1, successfulDays: 3, longest: 3 });
    await createGoal(u.id, routineGoal({ name: "Again", startDate: "2026-03-05" }), at("2026-03-05"));
    await expectGoalError(abandonGoal(u.id, id, at("2026-03-05")), "CONFLICT");
  });

  it("goals belong to their owner only", async () => {
    const owner = await user("owner");
    const other = await user("intruder");
    const { id } = await createGoal(owner.id, routineGoal(), at(MON));
    await expectGoalError(abandonGoal(other.id, id, at(MON)), "NOT_FOUND");
    await expectGoalError(updateGoal(other.id, id, { name: "Mine now" }, at(MON)), "NOT_FOUND");
  });
});

describe("editing", () => {
  it("requirement changes apply from tomorrow; past days keep their rules", async () => {
    const u = await user("edit-req");
    const { id } = await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    await readyDay(u.id, MON);
    await updateGoal(u.id, id, { requirements: [{ type: "JOURNAL_ENTRY", label: null, mandatory: true }] }, at(MON, "18:00:00"));
    await prisma.dailyNote.create({
      data: { userId: u.id, date: dateKeyToUtcDate("2026-03-03"), content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Patient today." }] }] } },
    });
    const o = await getGoalsOverview(u.id, at("2026-03-05"));
    expect(o.active?.days.slice(0, 2).map((d) => d.status)).toEqual(["QUALIFIED", "QUALIFIED"]);
    expect(o.active?.requirements.map((r) => r.type)).toEqual(["JOURNAL_ENTRY"]);
  });

  it("the target can't drop to or below the current streak", async () => {
    const u = await user("edit-target");
    const { id } = await createGoal(u.id, routineGoal(), at(MON, "06:00:00"));
    for (const d of tradingDays(MON, 3)) await readyDay(u.id, d);
    await expectGoalError(updateGoal(u.id, id, { targetDays: 3 }, at("2026-03-05")), "INVALID");
    await updateGoal(u.id, id, { targetDays: 10, name: "Ten sessions" }, at("2026-03-05"));
    expect(await prisma.goal.findUniqueOrThrow({ where: { id } })).toMatchObject({ targetDays: 10, name: "Ten sessions" });
  });
});

describe("custom check-ins", () => {
  it("counts a check-in for today or yesterday, and refuses older or final dates", async () => {
    const u = await user("checkin");
    const { id } = await createGoal(
      u.id,
      routineGoal({ requirements: [{ type: "CUSTOM_CHECKIN", label: "Gym before the open", mandatory: true }] }),
      at(MON, "06:00:00"),
    );
    const req = await prisma.goalRequirement.findFirstOrThrow({ where: { goalId: id } });
    await setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: MON, checked: true }, at(MON, "09:00:00"));
    await setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: MON, checked: true }, at(MON, "09:05:00")); // duplicate is a no-op
    await setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: "2026-03-03", checked: true }, at("2026-03-04", "07:00:00")); // yesterday
    await expectGoalError(
      setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: MON, checked: true }, at("2026-03-04")),
      "INVALID",
    );
    const o = await getGoalsOverview(u.id, at("2026-03-04", "07:00:00"));
    expect(o.active?.currentStreak).toBe(2);
    expect(await prisma.goalCheckIn.count({ where: { goalId: id } })).toBe(2);
    // Tuesday already qualified and is past, so it is final and can't be unticked.
    await expectGoalError(
      setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: "2026-03-03", checked: false }, at("2026-03-04", "08:00:00")),
      "CONFLICT",
    );
    // Today is still open: tick, then untick.
    await setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: "2026-03-04", checked: true }, at("2026-03-04", "09:00:00"));
    await setGoalCheckIn(u.id, { goalId: id, requirementId: req.id, dateKey: "2026-03-04", checked: false }, at("2026-03-04", "10:00:00"));
    expect(await prisma.goalCheckIn.count({ where: { goalId: id } })).toBe(2);
  });
});

describe("progress summary (Dashboard)", () => {
  it("one call brings goals and achievements up to date, with next milestone and this week's consistency", async () => {
    const u = await user("summary");
    await createGoal(u.id, routineGoal({ targetDays: 10 }), at(MON, "06:00:00"));
    const days = tradingDays(MON, 8).filter((d) => d !== "2026-03-04"); // Wed missed
    for (const d of days) await readyDay(u.id, d);
    const { goals, achievements } = await getProgressSummary(u.id, at("2026-03-12", "18:00:00"));
    // Thu 5, Fri 6, Mon 9, Tue 10, Wed 11 qualified; today (Thu 12) is still open → current 5.
    expect(goals.active).toMatchObject({ currentStreak: 5, nextMilestone: { days: 7, title: "One Week Strong" } });
    // Last 7 calendar days (Fri 6 – Thu 12): 4 decided trading days, all qualified; today isn't decided yet.
    expect(goals.active?.thisWeek).toEqual({ qualified: 4, owed: 4 });
    expect(achievements.achievements.find((a) => a.key === "goal.streak3")?.unlocked).toBe(true);
    expect(achievements.unlocked).toBeGreaterThan(0);
  });

  it("the next milestone never goes past the goal's own target", async () => {
    const u = await user("summary-cap");
    await createGoal(u.id, routineGoal({ targetDays: 5 }), at(MON, "06:00:00"));
    await readyDay(u.id, MON);
    const { goals } = await getProgressSummary(u.id, at("2026-03-03", "06:00:00"));
    expect(goals.active?.nextMilestone).toEqual({ days: 3, title: "Building Momentum" });
    const later = await getProgressSummary(u.id, at("2026-03-03", "06:00:00"));
    expect(later.goals.active?.currentStreak).toBe(1);
  });
});
