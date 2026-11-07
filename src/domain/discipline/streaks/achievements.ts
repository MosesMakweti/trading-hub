/**
 * Discipline achievements — catalogue and evaluation (pure).
 *
 * Achievements reward process, never outcome: routine days, reviewed trades,
 * plan-adherent trades and the streaks built from them. None counts trades
 * placed, profit, R or win rate.
 *
 * Evaluation is deterministic from the derived day series: `achievedOn` is
 * the local date the threshold was actually first met (the N-th credit, or
 * the date a streak first reached N). The service persists an unlock the
 * first time it is observed and never deletes it, so a historical
 * achievement survives later edits to the records that earned it.
 */
import type { TrackKey } from "./tracks";

export type AchievementMetric = "TOTAL" | "STREAK";

export interface AchievementDefinition {
  key: string;
  track: TrackKey;
  title: string;
  description: string;
  metric: AchievementMetric;
  target: number;
}

/**
 * Order = display order. Keys are persisted: never rename one. Titles may
 * change (they are display only); they must stay distinct from the Goals
 * milestone names in domain/achievements/catalogue.ts.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { key: "routine.first", track: "routine", title: "Routine Ready", description: "Complete your first full routine day.", metric: "TOTAL", target: 1 },
  { key: "routine.streak7", track: "routine", title: "Consistent", description: "Complete 7 consecutive routine days.", metric: "STREAK", target: 7 },
  { key: "routine.streak30", track: "routine", title: "Disciplined", description: "Complete 30 consecutive routine days.", metric: "STREAK", target: 30 },
  { key: "routine.streak90", track: "routine", title: "Unstoppable", description: "Complete 90 consecutive routine days.", metric: "STREAK", target: 90 },
  { key: "review.first", track: "review", title: "First Review", description: "Complete the final review of your first trade.", metric: "TOTAL", target: 1 },
  { key: "review.total25", track: "review", title: "Reflective Trader", description: "Review 25 trades.", metric: "TOTAL", target: 25 },
  { key: "review.total100", track: "review", title: "Analyst", description: "Review 100 trades.", metric: "TOTAL", target: 100 },
  { key: "review.total500", track: "review", title: "Master Reviewer", description: "Review 500 trades.", metric: "TOTAL", target: 500 },
  { key: "adherence.first", track: "adherence", title: "Rule Follower", description: "Record your first perfectly followed trade.", metric: "TOTAL", target: 1 },
  { key: "adherence.total10", track: "adherence", title: "Precision", description: "Record 10 perfectly followed trades.", metric: "TOTAL", target: 10 },
  { key: "adherence.total30", track: "adherence", title: "Steady Hands", description: "Record 30 perfectly followed trades.", metric: "TOTAL", target: 30 },
  { key: "adherence.total100", track: "adherence", title: "Rule Master", description: "Record 100 perfectly followed trades.", metric: "TOTAL", target: 100 },
];

export interface TrackAchievementInput {
  /** One local date per credit, ascending (routine day / reviewed trade / perfect trade). */
  creditDates: readonly string[];
  longest: number;
  /** First date each streak length was reached (from deriveDailyStreak's thresholds). */
  streakReachedOn: Readonly<Record<number, string>>;
}

export interface AchievementEvaluation {
  key: string;
  achieved: boolean;
  achievedOn: string | null;
  /** Current value of the metric, capped at the target. */
  progress: number;
  target: number;
}

export const ACHIEVEMENT_STREAK_THRESHOLDS: readonly number[] = [
  ...new Set(ACHIEVEMENTS.filter((a) => a.metric === "STREAK").map((a) => a.target)),
];

export function evaluateAchievements(inputs: Readonly<Record<TrackKey, TrackAchievementInput>>): AchievementEvaluation[] {
  return ACHIEVEMENTS.map((a) => {
    const t = inputs[a.track];
    if (a.metric === "TOTAL") {
      const count = t.creditDates.length;
      const achieved = count >= a.target;
      return { key: a.key, achieved, achievedOn: achieved ? t.creditDates[a.target - 1] : null, progress: Math.min(count, a.target), target: a.target };
    }
    const achievedOn = t.streakReachedOn[a.target] ?? null;
    const achieved = achievedOn != null || t.longest >= a.target;
    return { key: a.key, achieved, achievedOn, progress: Math.min(t.longest, a.target), target: a.target };
  });
}

export function achievementDefinition(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}
