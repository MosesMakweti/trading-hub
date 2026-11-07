import { describe, expect, it } from "vitest";

import { ACHIEVEMENTS as DISCIPLINE_ACHIEVEMENTS } from "@/domain/discipline/streaks/achievements";
import {
  ACHIEVEMENT_CATALOGUE,
  STREAK_ACHIEVEMENTS,
  evaluateAllAchievements,
  goalCompletionLevel,
  goalStreakFacts,
  milestoneLevel,
  type AchievementFacts,
  type FinalGoalDayFact,
} from "@/domain/achievements";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";

const empty: AchievementFacts = {
  discipline: [],
  goalDays: [],
  reviewDates: [],
  riskCleanDates: [],
  journalDates: [],
  reviewCycleDates: [],
  completedGoals: [],
};

const result = (facts: Partial<AchievementFacts>, key: string) => {
  const r = evaluateAllAchievements({ ...empty, discipline: disciplineNone, ...facts }).find((x) => x.key === key);
  if (!r) throw new Error(`no ${key}`);
  return r;
};

const disciplineNone = DISCIPLINE_ACHIEVEMENTS.map((a) => ({ key: a.key, achieved: false, achievedOn: null, progress: 0, target: a.target }));

/** `n` consecutive qualifying days on one goal, from `from`. */
function run(goalId: string, from: string, n: number, startStreak = 0): FinalGoalDayFact[] {
  return Array.from({ length: n }, (_, i) => ({ goalId, dateKey: addDaysToDateKey(from, i), status: "QUALIFIED" as const, streakAfter: startStreak + i + 1 }));
}

describe("catalogue", () => {
  it("has unique keys and keeps every pre-existing Discipline key", () => {
    const keys = ACHIEVEMENT_CATALOGUE.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of DISCIPLINE_ACHIEVEMENTS) expect(keys).toContain(a.key);
  });

  it("has the ten consecutive-day milestones with the agreed names", () => {
    expect(STREAK_ACHIEVEMENTS.map((s) => [s.days, s.title])).toEqual([
      [1, "First Step"],
      [3, "Building Momentum"],
      [7, "One Week Strong"],
      [14, "Two Weeks of Discipline"],
      [21, "Consistency Builder"],
      [30, "Monthly Discipline"],
      [50, "Unbreakable Focus"],
      [60, "Elite Consistency"],
      [90, "Master of Discipline"],
      [100, "Century of Consistency"],
    ]);
  });

  it("titles are unique, so no two badges read the same", () => {
    const titles = ACHIEVEMENT_CATALOGUE.map((a) => a.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("covers every category and level", () => {
    expect(new Set(ACHIEVEMENT_CATALOGUE.map((a) => a.category))).toEqual(new Set(["CONSISTENCY", "TRADING_DISCIPLINE", "JOURNAL", "GOALS"]));
    expect(new Set(ACHIEVEMENT_CATALOGUE.map((a) => a.level))).toEqual(new Set([1, 2, 3]));
  });

  it("celebration levels grow with the size of the moment", () => {
    expect([1, 3, 7, 14, 30, 60, 90, 100].map(milestoneLevel)).toEqual([1, 1, 2, 2, 3, 3, 3, 3]);
    expect(goalCompletionLevel(7)).toBe(2);
    expect(goalCompletionLevel(30)).toBe(3);
  });
});

describe("goal streak facts", () => {
  it("dates each length by the first day it was reached, across goals", () => {
    const days = [...run("a", "2026-03-02", 3), ...run("b", "2026-04-01", 5)];
    const g = goalStreakFacts(days);
    expect(g.longest).toBe(5);
    expect(g.reachedOn[1]).toBe("2026-03-02");
    expect(g.reachedOn[3]).toBe("2026-03-04");
    expect(g.reachedOn[5]).toBe("2026-04-05");
  });

  it("Back Stronger: only when a later run beats a run that already ended", () => {
    // first attempt 3 days, a miss, then 4 → the 4th day beats the old best
    const days: FinalGoalDayFact[] = [
      ...run("a", "2026-03-02", 3),
      { goalId: "a", dateKey: "2026-03-05", status: "MISSED", streakAfter: 0 },
      ...run("a", "2026-03-06", 4),
    ];
    expect(goalStreakFacts(days).personalBestOn).toBe("2026-03-09");
    // a single unbroken run is never a "comeback"
    expect(goalStreakFacts(run("a", "2026-03-02", 20)).personalBestOn).toBeNull();
    // matching the old best is not beating it
    const tie: FinalGoalDayFact[] = [...run("a", "2026-03-02", 3), { goalId: "a", dateKey: "2026-03-05", status: "MISSED", streakAfter: 0 }, ...run("a", "2026-03-06", 3)];
    expect(goalStreakFacts(tie).personalBestOn).toBeNull();
  });

  it("rest and paused days do not end a run", () => {
    const days: FinalGoalDayFact[] = [
      ...run("a", "2026-03-05", 1),
      { goalId: "a", dateKey: "2026-03-06", status: "REST", streakAfter: 1 },
      { goalId: "a", dateKey: "2026-03-07", status: "PAUSED", streakAfter: 1 },
      { goalId: "a", dateKey: "2026-03-08", status: "QUALIFIED", streakAfter: 2 },
    ];
    expect(goalStreakFacts(days)).toMatchObject({ longest: 2, personalBestOn: null });
  });
});

describe("evaluation", () => {
  it("unlocks streak achievements from final goal days only, with progress towards the rest", () => {
    const days = run("a", "2026-03-02", 8);
    expect(result({ goalDays: days }, "goal.streak7")).toMatchObject({ achieved: true, achievedOn: "2026-03-08" });
    expect(result({ goalDays: days }, "goal.streak14")).toMatchObject({ achieved: false, progress: 8, target: 14 });
    expect(result({}, "goal.streak1")).toMatchObject({ achieved: false, progress: 0 });
  });

  it("counts reviews, risk-clean trades, journal days and review cycles", () => {
    const dates = Array.from({ length: 30 }, (_, i) => addDaysToDateKey("2026-01-01", i));
    expect(result({ reviewDates: dates }, "review.total10")).toMatchObject({ achieved: true, achievedOn: dates[9] });
    expect(result({ reviewDates: dates }, "review.total30")).toMatchObject({ achieved: true, achievedOn: dates[29] });
    expect(result({ riskCleanDates: dates.slice(0, 9) }, "risk.clean10")).toMatchObject({ achieved: false, progress: 9 });
    expect(result({ journalDates: dates.slice(0, 1) }, "journal.first")).toMatchObject({ achieved: true, achievedOn: dates[0] });
    expect(result({ journalDates: dates.slice(0, 14) }, "journal.days14")).toMatchObject({ achieved: true, achievedOn: dates[13] });
    expect(result({ reviewCycleDates: dates.slice(0, 4) }, "cycle.total4")).toMatchObject({ achieved: true });
  });

  it("goal completion achievements, including the 30- and 90-day challenges", () => {
    const completed = [
      { completedOn: "2026-02-01", targetDays: 7 },
      { completedOn: "2026-03-20", targetDays: 30 },
      { completedOn: "2026-07-01", targetDays: 90 },
    ];
    expect(result({ completedGoals: completed }, "goals.first")).toMatchObject({ achieved: true, achievedOn: "2026-02-01" });
    expect(result({ completedGoals: completed }, "goals.total3")).toMatchObject({ achieved: true, achievedOn: "2026-07-01" });
    expect(result({ completedGoals: completed }, "goals.total5")).toMatchObject({ achieved: false, progress: 3 });
    expect(result({ completedGoals: completed }, "goals.challenge30")).toMatchObject({ achieved: true, achievedOn: "2026-03-20" });
    expect(result({ completedGoals: completed }, "goals.challenge90")).toMatchObject({ achieved: true, achievedOn: "2026-07-01" });
    expect(result({ completedGoals: completed.slice(0, 1) }, "goals.challenge30")).toMatchObject({ achieved: false, progress: 7 });
  });

  it("passes the Discipline-track evaluations through unchanged", () => {
    const discipline = disciplineNone.map((d) => (d.key === "routine.first" ? { ...d, achieved: true, achievedOn: "2026-02-03", progress: 1 } : d));
    expect(result({ discipline }, "routine.first")).toMatchObject({ achieved: true, achievedOn: "2026-02-03" });
  });

  it("returns exactly one result per catalogue entry", () => {
    const all = evaluateAllAchievements({ ...empty, discipline: disciplineNone });
    expect(all.map((r) => r.key)).toEqual(ACHIEVEMENT_CATALOGUE.map((a) => a.key));
    expect(all.every((r) => !r.achieved)).toBe(true);
  });
});
