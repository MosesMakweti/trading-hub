import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import { STREAK_ACHIEVEMENTS, streakAchievementKey } from "@/domain/achievements";
import { abandonGoal, createGoal, getGoalsOverview, syncProgress } from "@/server/services/goals.service";
import {
  dismissCelebrations,
  getAchievementsOverview,
  getCelebrationPreferences,
  getPendingCelebrations,
  setCelebrationPreferences,
} from "@/server/services/achievements.service";
import { acknowledgeAchievements } from "@/server/services/discipline-streaks.service";
import type { CreateGoalInput } from "@/lib/validation/goals";

/**
 * Achievements & celebrations — integration tests against the test Postgres
 * DB. Activity is inserted directly and `now` injected (users have no
 * timezone row → UTC).
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`ach-${label}`);
  userIds.push(u.id);
  await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  return u;
}

const MON = "2026-03-02";
const at = (dateKey: string, time = "12:00:00") => new Date(`${dateKey}T${time}Z`);

function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let k = from; out.length < n; k = addDaysToDateKey(k, 1)) {
    const dow = new Date(`${k}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(k);
  }
  return out;
}

async function readyDays(userId: string, dates: string[]) {
  await prisma.tradingDay.createMany({
    data: dates.map((d) => ({
      userId,
      date: dateKeyToUtcDate(d),
      routineReadyAt: at(d, "07:30:00"),
      routineFirstReadyAt: at(d, "07:30:00"),
      analyzedAt: at(d, "21:00:00"),
      status: "ARCHIVED" as const,
      dayMainLesson: "Waited for my levels.",
    })),
  });
}

const goalInput = (o: Partial<CreateGoalInput> = {}): CreateGoalInput => ({
  name: "Prepare every session",
  description: null,
  category: "ROUTINE",
  targetDays: 30,
  startDate: MON,
  requirements: [{ type: "PRE_SESSION_ROUTINE", label: null, mandatory: true }],
  ...o,
});

async function events(userId: string) {
  return prisma.progressEvent.findMany({ where: { userId }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] });
}

describe("unlocking", () => {
  it("unlocks every consecutive-day milestone up to 100, the goal and both challenges — each exactly once", async () => {
    const u = await user("all-milestones");
    await createGoal(u.id, goalInput({ targetDays: 100, name: "One hundred sessions" }), at(MON, "06:00:00"));
    const days = tradingDays(MON, 100);
    await readyDays(u.id, days);
    const later = at(addDaysToDateKey(days[99], 2));
    await syncProgress(u.id, later);
    await syncProgress(u.id, later); // a refresh awards nothing new

    const unlocked = new Set((await prisma.disciplineAchievement.findMany({ where: { userId: u.id } })).map((a) => a.key));
    for (const s of STREAK_ACHIEVEMENTS) expect(unlocked.has(streakAchievementKey(s.days))).toBe(true);
    for (const k of ["goals.first", "goals.challenge30", "goals.challenge90", "routine.first", "routine.streak90"]) expect(unlocked.has(k)).toBe(true);

    const ev = await events(u.id);
    const achievementEvents = ev.filter((e) => e.kind === "ACHIEVEMENT");
    expect(achievementEvents).toHaveLength(unlocked.size);
    expect(new Set(achievementEvents.map((e) => e.achievementKey)).size).toBe(unlocked.size);
    // First time reaching each length → the achievement celebrates it; no duplicate milestone event.
    expect(ev.filter((e) => e.kind === "MILESTONE")).toHaveLength(0);
    expect(ev.filter((e) => e.kind === "GOAL_COMPLETED")).toHaveLength(1);
    expect(utcDateToKey(ev.find((e) => e.achievementKey === "goal.streak100")!.occurredOn)).toBe(days[99]);
  });

  it("concurrent syncs never duplicate an unlock or its event", async () => {
    const u = await user("race");
    await createGoal(u.id, goalInput(), at(MON, "06:00:00"));
    await readyDays(u.id, tradingDays(MON, 7));
    const now = at("2026-03-12");
    await Promise.all(Array.from({ length: 5 }, () => syncProgress(u.id, now)));
    const keys = (await events(u.id)).map((e) => e.achievementKey ?? `${e.kind}:${e.days}`);
    expect(keys.length).toBe(new Set(keys).size);
    expect(keys).toContain(streakAchievementKey(7));
  });

  it("a later goal reaching a length again is a goal milestone, not a second achievement", async () => {
    const u = await user("repeat");
    const first = await createGoal(u.id, goalInput({ name: "First" }), at(MON, "06:00:00"));
    const week1 = tradingDays(MON, 7);
    await readyDays(u.id, week1);
    await syncProgress(u.id, at("2026-03-11"));
    await abandonGoal(u.id, first.id, at("2026-03-11"));

    const start = "2026-03-16"; // next Monday
    await createGoal(u.id, goalInput({ name: "Second", startDate: start }), at(start, "06:00:00"));
    await readyDays(u.id, tradingDays(start, 7));
    await syncProgress(u.id, at("2026-03-25"));

    const ev = await events(u.id);
    expect(ev.filter((e) => e.achievementKey === streakAchievementKey(7))).toHaveLength(1);
    const milestones = ev.filter((e) => e.kind === "MILESTONE");
    expect(milestones.map((e) => e.days)).toEqual([3, 7]);
    expect(await prisma.disciplineAchievement.count({ where: { userId: u.id, key: streakAchievementKey(7) } })).toBe(1);
  });

  it("goal achievements and the goal-completion event are written when a goal completes", async () => {
    const u = await user("complete");
    await createGoal(u.id, goalInput({ targetDays: 7 }), at(MON, "06:00:00"));
    const days = tradingDays(MON, 7);
    await readyDays(u.id, days);
    const o = await getGoalsOverview(u.id, at(addDaysToDateKey(days[6], 1)));
    expect(o.stats.goalsCompleted).toBe(1);
    const ev = await events(u.id);
    expect(ev.filter((e) => e.kind === "GOAL_COMPLETED").map((e) => utcDateToKey(e.occurredOn))).toEqual([days[6]]);
    expect(ev.some((e) => e.achievementKey === "goals.first")).toBe(true);
  });

  it("journal, review and review-cycle achievements come from existing records", async () => {
    const u = await user("journal");
    await prisma.dailyNote.create({
      data: { userId: u.id, date: dateKeyToUtcDate(MON), content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Patient." }] }] } },
    });
    await prisma.dailyNote.create({ data: { userId: u.id, date: dateKeyToUtcDate("2026-03-03"), content: { type: "doc", content: [{ type: "paragraph" }] } } });
    await prisma.replayReviewSession.create({
      data: { userId: u.id, reviewType: "WEEKLY", status: "COMPLETED", completedAt: at("2026-03-06", "18:00:00"), startDate: dateKeyToUtcDate(MON), endDate: dateKeyToUtcDate("2026-03-06") },
    });
    const o = await getAchievementsOverview(u.id, at("2026-03-09"));
    const byKey = new Map(o.achievements.map((a) => [a.key, a]));
    expect(byKey.get("journal.first")).toMatchObject({ unlocked: true, achievedOn: MON });
    expect(byKey.get("journal.days14")).toMatchObject({ unlocked: false, progress: 1, target: 14 }); // the empty note doesn't count
    expect(byKey.get("cycle.first")).toMatchObject({ unlocked: true, achievedOn: "2026-03-06" });
    expect(o.unlocked).toBe(2);
    expect(o.total).toBe(o.achievements.length);
    expect(o.recent.map((a) => a.key).sort()).toEqual(["cycle.first", "journal.first"]);
  });
});

describe("celebrations", () => {
  it("queues unseen celebrations, biggest first, and shows each exactly once", async () => {
    const u = await user("queue");
    await createGoal(u.id, goalInput({ targetDays: 7 }), at(MON, "06:00:00"));
    await readyDays(u.id, tradingDays(MON, 7));
    // The trader was away: everything finalizes on their next visit.
    await syncProgress(u.id, at("2026-03-16"));

    const pending = await getPendingCelebrations(u.id);
    expect(pending.length).toBeGreaterThan(3);
    expect(pending.map((c) => c.level)).toEqual([...pending.map((c) => c.level)].sort((a, b) => b - a));
    expect(pending.find((c) => c.kind === "GOAL_COMPLETED")).toMatchObject({ title: "Prepare every session", goalName: "Prepare every session", days: 7 });
    expect(pending.find((c) => c.achievementKey === "goal.streak7")).toMatchObject({ title: "One Week Strong", level: 2 });

    // Navigation and refresh don't consume them…
    expect(await getPendingCelebrations(u.id)).toHaveLength(pending.length);
    // …dismissing does, once and for good.
    await dismissCelebrations(u.id, [pending[0].id]);
    expect((await getPendingCelebrations(u.id)).map((c) => c.id)).not.toContain(pending[0].id);
    await dismissCelebrations(u.id, null);
    expect(await getPendingCelebrations(u.id)).toHaveLength(0);
    await syncProgress(u.id, at("2026-03-16"));
    expect(await getPendingCelebrations(u.id)).toHaveLength(0);

    // Dismissing an achievement celebration also marks the achievement seen (Discipline banner).
    expect(await prisma.disciplineAchievement.count({ where: { userId: u.id, seenAt: null } })).toBe(0);
  });

  it("the Discipline banner's dismissal also clears the matching celebration", async () => {
    const u = await user("banner");
    await createGoal(u.id, goalInput(), at(MON, "06:00:00"));
    await readyDays(u.id, [MON]);
    await syncProgress(u.id, at("2026-03-03"));
    expect((await getPendingCelebrations(u.id)).some((c) => c.achievementKey === "routine.first")).toBe(true);
    await acknowledgeAchievements(u.id, ["routine.first"]);
    expect((await getPendingCelebrations(u.id)).some((c) => c.achievementKey === "routine.first")).toBe(false);
  });

  it("events are history: seenAt is written once, and an event can't be edited or deleted", async () => {
    const u = await user("immutable");
    await createGoal(u.id, goalInput(), at(MON, "06:00:00"));
    await readyDays(u.id, [MON]);
    await syncProgress(u.id, at("2026-03-03"));
    const e = await prisma.progressEvent.findFirstOrThrow({ where: { userId: u.id } });
    await prisma.progressEvent.update({ where: { id: e.id }, data: { seenAt: new Date() } });
    await expect(prisma.progressEvent.update({ where: { id: e.id }, data: { seenAt: new Date(Date.now() + 1000) } })).rejects.toThrow(/PROGRESS_IMMUTABLE/);
    await expect(prisma.progressEvent.update({ where: { id: e.id }, data: { days: 5 } })).rejects.toThrow(/PROGRESS_IMMUTABLE/);
    await expect(prisma.progressEvent.delete({ where: { id: e.id } })).rejects.toThrow(/PROGRESS_IMMUTABLE/);
  });

  it("one trader can't see or dismiss another's celebrations", async () => {
    const a = await user("owner");
    const b = await user("other");
    await createGoal(a.id, goalInput(), at(MON, "06:00:00"));
    await readyDays(a.id, [MON]);
    await syncProgress(a.id, at("2026-03-03"));
    const mine = await getPendingCelebrations(a.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(await getPendingCelebrations(b.id)).toHaveLength(0);
    expect(await dismissCelebrations(b.id, mine.map((c) => c.id))).toBe(0);
    expect(await getPendingCelebrations(a.id)).toHaveLength(mine.length);
  });
});

describe("preferences", () => {
  it("animations on and sound off by default; both can be changed", async () => {
    const u = await user("prefs");
    expect(await getCelebrationPreferences(u.id)).toEqual({ animations: true, sound: false });
    expect(await setCelebrationPreferences(u.id, { animations: false })).toEqual({ animations: false, sound: false });
    expect(await setCelebrationPreferences(u.id, { sound: true })).toEqual({ animations: false, sound: true });
  });
});
