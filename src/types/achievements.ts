/**
 * Achievements & celebrations — serializable view models (server → client).
 */
import type { AchievementCategory, CelebrationLevel } from "@/domain/achievements";

export interface AchievementDTO {
  key: string;
  category: AchievementCategory;
  title: string;
  description: string;
  level: CelebrationLevel;
  icon: string;
  unit: string;
  target: number;
  /** Capped at the target; equals it once unlocked. */
  progress: number;
  unlocked: boolean;
  /** Trader-local date the threshold was met. */
  achievedOn: string | null;
  unlockedAt: string | null;
}

export interface AchievementsOverviewDTO {
  unlocked: number;
  total: number;
  percent: number;
  categories: { key: AchievementCategory; title: string; description: string; unlocked: number; total: number }[];
  achievements: AchievementDTO[];
  /** Most recent unlocks first. */
  recent: AchievementDTO[];
}

export interface CelebrationDTO {
  id: string;
  kind: "ACHIEVEMENT" | "MILESTONE" | "GOAL_COMPLETED";
  level: CelebrationLevel;
  title: string;
  description: string;
  icon: string;
  occurredOn: string;
  /** MILESTONE: the streak length; GOAL_COMPLETED: the goal's target. */
  days: number | null;
  goalName: string | null;
  achievementKey: string | null;
}

export interface CelebrationPreferencesDTO {
  animations: boolean;
  sound: boolean;
}
