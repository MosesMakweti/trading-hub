/**
 * Achievements — the single catalogue (pure).
 *
 * Definitions live in code; a user's unlocks live in DisciplineAchievement
 * (one row per user and key, never removed) and every unlock, goal milestone
 * and goal completion is queued for celebration in ProgressEvent.
 *
 * KEYS ARE PERSISTED: never rename or reuse one. Titles and descriptions are
 * display only. The twelve Discipline-track keys (routine.*, review.*,
 * adherence.*) predate this catalogue and keep their own evaluation in
 * domain/discipline/streaks/achievements.ts; this file gives them a category,
 * a celebration level and an icon.
 *
 * Every achievement rewards process and consistency, never outcome: no
 * profit, R or win rate is an input anywhere.
 */
import { ACHIEVEMENTS as DISCIPLINE_ACHIEVEMENTS } from "@/domain/discipline/streaks/achievements";

export type AchievementCategory = "CONSISTENCY" | "TRADING_DISCIPLINE" | "JOURNAL" | "GOALS";

/** 1 small (toast) · 2 medium (animated card) · 3 major (overlay). */
export type CelebrationLevel = 1 | 2 | 3;

export interface AchievementDefinition {
  key: string;
  category: AchievementCategory;
  title: string;
  description: string;
  level: CelebrationLevel;
  /** The number the progress bar counts towards. */
  target: number;
  /** Unit of `target` for "12 / 30 days" style progress. */
  unit: string;
  /** Lucide icon name, rendered inside the badge. */
  icon: string;
}

export const ACHIEVEMENT_CATEGORIES: readonly { key: AchievementCategory; title: string; description: string }[] = [
  { key: "CONSISTENCY", title: "Consistency", description: "Consecutive qualifying trading days on your goals." },
  { key: "TRADING_DISCIPLINE", title: "Trading discipline", description: "Your routine, following your plan, respecting risk and completing review cycles." },
  { key: "JOURNAL", title: "Journal", description: "Writing your journal and reviewing your trades." },
  { key: "GOALS", title: "Goals", description: "Goals you have seen through to the end." },
];

/** Goal-streak lengths with a personal achievement (and a goal milestone). */
export const STREAK_ACHIEVEMENTS: readonly { days: number; title: string; level: CelebrationLevel }[] = [
  { days: 1, title: "First Step", level: 1 },
  { days: 3, title: "Building Momentum", level: 1 },
  { days: 7, title: "One Week Strong", level: 2 },
  { days: 14, title: "Two Weeks of Discipline", level: 2 },
  { days: 21, title: "Consistency Builder", level: 2 },
  { days: 30, title: "Monthly Discipline", level: 3 },
  { days: 50, title: "Unbreakable Focus", level: 3 },
  { days: 60, title: "Elite Consistency", level: 3 },
  { days: 90, title: "Master of Discipline", level: 3 },
  { days: 100, title: "Century of Consistency", level: 3 },
];

export const streakAchievementKey = (days: number) => `goal.streak${days}`;

const streakDefs: AchievementDefinition[] = STREAK_ACHIEVEMENTS.map((s) => ({
  key: streakAchievementKey(s.days),
  category: "CONSISTENCY",
  title: s.title,
  description:
    s.days === 1
      ? "Complete your first qualifying day on a goal."
      : `Reach ${s.days} consecutive qualifying trading days on a goal.`,
  level: s.level,
  target: s.days,
  unit: "days",
  icon: s.days >= 30 ? "Flame" : s.days >= 7 ? "CalendarCheck" : "Footprints",
}));

/** Category, level and icon for the pre-existing Discipline-track keys. */
const DISCIPLINE_META: Record<string, Pick<AchievementDefinition, "category" | "level" | "icon" | "unit">> = {
  "routine.first": { category: "TRADING_DISCIPLINE", level: 1, icon: "Sunrise", unit: "routine days" },
  "routine.streak7": { category: "TRADING_DISCIPLINE", level: 2, icon: "Sunrise", unit: "days" },
  "routine.streak30": { category: "TRADING_DISCIPLINE", level: 3, icon: "Sunrise", unit: "days" },
  "routine.streak90": { category: "TRADING_DISCIPLINE", level: 3, icon: "Sunrise", unit: "days" },
  "adherence.first": { category: "TRADING_DISCIPLINE", level: 1, icon: "Target", unit: "trades" },
  "adherence.total10": { category: "TRADING_DISCIPLINE", level: 2, icon: "Target", unit: "trades" },
  "adherence.total30": { category: "TRADING_DISCIPLINE", level: 2, icon: "Target", unit: "trades" },
  "adherence.total100": { category: "TRADING_DISCIPLINE", level: 3, icon: "Target", unit: "trades" },
  "review.first": { category: "JOURNAL", level: 1, icon: "ClipboardCheck", unit: "reviews" },
  "review.total25": { category: "JOURNAL", level: 2, icon: "ClipboardCheck", unit: "reviews" },
  "review.total100": { category: "JOURNAL", level: 3, icon: "ClipboardCheck", unit: "reviews" },
  "review.total500": { category: "JOURNAL", level: 3, icon: "ClipboardCheck", unit: "reviews" },
};

const disciplineDefs: AchievementDefinition[] = DISCIPLINE_ACHIEVEMENTS.map((a) => {
  const meta = DISCIPLINE_META[a.key];
  if (!meta) throw new Error(`Missing catalogue metadata for ${a.key}`);
  return { key: a.key, title: a.title, description: a.description, target: a.target, ...meta };
});

const newDefs: AchievementDefinition[] = [
  // Consistency
  {
    key: "goal.personalBest",
    category: "CONSISTENCY",
    title: "Back Stronger",
    description: "Start again and build a streak longer than your previous best.",
    level: 2,
    target: 1,
    unit: "record",
    icon: "TrendingUp",
  },
  // Trading discipline
  { key: "risk.clean10", category: "TRADING_DISCIPLINE", title: "Risk Keeper", description: "Review 10 trades with no risk rule broken.", level: 1, target: 10, unit: "trades", icon: "ShieldCheck" },
  { key: "risk.clean50", category: "TRADING_DISCIPLINE", title: "Risk Guardian", description: "Review 50 trades with no risk rule broken.", level: 2, target: 50, unit: "trades", icon: "ShieldCheck" },
  { key: "cycle.first", category: "TRADING_DISCIPLINE", title: "Full Circle", description: "Complete your first weekly or monthly Edge Review.", level: 1, target: 1, unit: "reviews", icon: "RefreshCcw" },
  { key: "cycle.total4", category: "TRADING_DISCIPLINE", title: "Reflective Cycle", description: "Complete 4 Edge Reviews.", level: 2, target: 4, unit: "reviews", icon: "RefreshCcw" },
  { key: "cycle.total12", category: "TRADING_DISCIPLINE", title: "Review Ritual", description: "Complete 12 Edge Reviews.", level: 3, target: 12, unit: "reviews", icon: "RefreshCcw" },
  // Journal
  { key: "journal.first", category: "JOURNAL", title: "First Journal Entry", description: "Write your first daily journal note.", level: 1, target: 1, unit: "entries", icon: "NotebookPen" },
  { key: "journal.days14", category: "JOURNAL", title: "Journal Habit", description: "Write a journal note on 14 different days.", level: 2, target: 14, unit: "days", icon: "NotebookPen" },
  { key: "review.total10", category: "JOURNAL", title: "Ten Reviews", description: "Complete the final review of 10 trades.", level: 1, target: 10, unit: "reviews", icon: "ClipboardCheck" },
  { key: "review.total30", category: "JOURNAL", title: "Thirty Reviews", description: "Complete the final review of 30 trades.", level: 2, target: 30, unit: "reviews", icon: "ClipboardCheck" },
  // Goals
  { key: "goals.first", category: "GOALS", title: "Goal Achieved", description: "Complete your first goal.", level: 2, target: 1, unit: "goals", icon: "Flag" },
  { key: "goals.total3", category: "GOALS", title: "Hat-Trick", description: "Complete 3 goals.", level: 2, target: 3, unit: "goals", icon: "Flag" },
  { key: "goals.total5", category: "GOALS", title: "Proven Commitment", description: "Complete 5 goals.", level: 3, target: 5, unit: "goals", icon: "Flag" },
  { key: "goals.challenge30", category: "GOALS", title: "30-Day Challenge", description: "Complete a goal of 30 days or more.", level: 3, target: 30, unit: "days", icon: "Mountain" },
  { key: "goals.challenge90", category: "GOALS", title: "90-Day Challenge", description: "Complete a goal of 90 days or more.", level: 3, target: 90, unit: "days", icon: "Mountain" },
];

/** Every achievement, in display order (by category, then as listed). */
export const ACHIEVEMENT_CATALOGUE: readonly AchievementDefinition[] = (() => {
  const all = [...streakDefs, ...newDefs, ...disciplineDefs];
  const order = ACHIEVEMENT_CATEGORIES.map((c) => c.key);
  const keys = new Set<string>();
  for (const a of all) {
    if (keys.has(a.key)) throw new Error(`Duplicate achievement key ${a.key}`);
    keys.add(a.key);
  }
  return all.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
})();

export function achievementByKey(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOGUE.find((a) => a.key === key);
}

/** Goal milestones celebrated per goal (they can recur on every goal). */
export const GOAL_MILESTONES: readonly number[] = [3, 7, 14, 21, 30, 50, 60, 90, 100];

export function milestoneLevel(days: number): CelebrationLevel {
  return days >= 30 ? 3 : days >= 7 ? 2 : 1;
}

export function goalCompletionLevel(targetDays: number): CelebrationLevel {
  return targetDays >= 30 ? 3 : 2;
}
