/**
 * Achievements — evaluation from facts (pure).
 *
 * Deterministic: `achievedOn` is the trader-local date the threshold was
 * first met, taken from the records themselves. Goal-streak achievements
 * only read FINAL goal days, so nothing is awarded for a day that could
 * still change.
 */
import type { AchievementEvaluation as DisciplineEvaluation } from "@/domain/discipline/streaks/achievements";
import { ACHIEVEMENT_CATALOGUE, STREAK_ACHIEVEMENTS, streakAchievementKey } from "./catalogue";

export interface FinalGoalDayFact {
  goalId: string;
  dateKey: string;
  status: "QUALIFIED" | "MISSED" | "REST" | "PAUSED";
  streakAfter: number;
}

export interface AchievementFacts {
  /** The pre-existing Discipline-track evaluations (routine.*, review.*, adherence.*). */
  discipline: readonly DisciplineEvaluation[];
  /** Every final goal day, grouped by goal in creation order, each goal ascending by date. */
  goalDays: readonly FinalGoalDayFact[];
  /** One local date per trade whose final review is complete, ascending. */
  reviewDates: readonly string[];
  /** One local date per reviewed trade with no risk violation, ascending. */
  riskCleanDates: readonly string[];
  /** Local dates with a real journal note, ascending, distinct. */
  journalDates: readonly string[];
  /** One local date per completed Edge Review (weekly or monthly), ascending. */
  reviewCycleDates: readonly string[];
  /** Completed goals, ascending by completion date. */
  completedGoals: readonly { completedOn: string; targetDays: number }[];
}

export interface AchievementResult {
  key: string;
  achieved: boolean;
  achievedOn: string | null;
  /** Current value, capped at the target. */
  progress: number;
  target: number;
}

function total(key: string, dates: readonly string[], target: number): AchievementResult {
  const achieved = dates.length >= target;
  return { key, achieved, achievedOn: achieved ? dates[target - 1] : null, progress: Math.min(dates.length, target), target };
}

/** The first date each streak length was reached, the longest streak, and the "Back Stronger" date. */
export function goalStreakFacts(days: readonly FinalGoalDayFact[]): {
  longest: number;
  reachedOn: Record<number, string>;
  personalBestOn: string | null;
} {
  const reachedOn: Record<number, string> = {};
  let longest = 0;
  let personalBestOn: string | null = null;
  // The best run that has already ENDED (by a miss or by its goal ending).
  let bestEnded = 0;
  let currentGoal: string | null = null;
  let run = 0;

  const endRun = () => {
    bestEnded = Math.max(bestEnded, run);
    run = 0;
  };

  for (const d of days) {
    if (d.goalId !== currentGoal) {
      endRun();
      currentGoal = d.goalId;
    }
    if (d.status === "QUALIFIED") {
      run = d.streakAfter;
      longest = Math.max(longest, run);
      if (reachedOn[run] == null || d.dateKey < reachedOn[run]) reachedOn[run] = d.dateKey;
      if (personalBestOn == null && bestEnded > 0 && run === bestEnded + 1) personalBestOn = d.dateKey;
    } else if (d.status === "MISSED") {
      endRun();
    }
  }
  return { longest, reachedOn, personalBestOn };
}

export function evaluateAllAchievements(f: AchievementFacts): AchievementResult[] {
  const byKey = new Map<string, AchievementResult>();

  for (const e of f.discipline) {
    byKey.set(e.key, { key: e.key, achieved: e.achieved, achievedOn: e.achievedOn, progress: e.progress, target: e.target });
  }

  const g = goalStreakFacts(f.goalDays);
  for (const s of STREAK_ACHIEVEMENTS) {
    const key = streakAchievementKey(s.days);
    const on = g.reachedOn[s.days] ?? null;
    byKey.set(key, { key, achieved: on != null, achievedOn: on, progress: Math.min(g.longest, s.days), target: s.days });
  }
  byKey.set("goal.personalBest", {
    key: "goal.personalBest",
    achieved: g.personalBestOn != null,
    achievedOn: g.personalBestOn,
    progress: g.personalBestOn != null ? 1 : 0,
    target: 1,
  });

  for (const [key, dates, target] of [
    ["risk.clean10", f.riskCleanDates, 10],
    ["risk.clean50", f.riskCleanDates, 50],
    ["cycle.first", f.reviewCycleDates, 1],
    ["cycle.total4", f.reviewCycleDates, 4],
    ["cycle.total12", f.reviewCycleDates, 12],
    ["journal.first", f.journalDates, 1],
    ["journal.days14", f.journalDates, 14],
    ["review.total10", f.reviewDates, 10],
    ["review.total30", f.reviewDates, 30],
  ] as const) {
    byKey.set(key, total(key, dates, target));
  }

  const completedDates = f.completedGoals.map((c) => c.completedOn);
  byKey.set("goals.first", total("goals.first", completedDates, 1));
  byKey.set("goals.total3", total("goals.total3", completedDates, 3));
  byKey.set("goals.total5", total("goals.total5", completedDates, 5));
  for (const [key, min] of [
    ["goals.challenge30", 30],
    ["goals.challenge90", 90],
  ] as const) {
    const first = f.completedGoals.find((c) => c.targetDays >= min) ?? null;
    const best = f.completedGoals.reduce((m, c) => Math.max(m, c.targetDays), 0);
    byKey.set(key, { key, achieved: first != null, achievedOn: first?.completedOn ?? null, progress: Math.min(best, min), target: min });
  }

  return ACHIEVEMENT_CATALOGUE.map((a) => {
    const r = byKey.get(a.key);
    if (!r) throw new Error(`No evaluation for achievement ${a.key}`);
    return r;
  });
}
