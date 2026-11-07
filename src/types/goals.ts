/**
 * Goals — serializable view models (server → client). Plain JSON only:
 * dates are YYYY-MM-DD trader-local keys or ISO strings. Every number was
 * derived on the server; the UI only formats.
 */
import type { GoalRequirementType, LiveGoalDayStatus, RequirementResult } from "@/domain/goals";

export type GoalStatusDTO = "ACTIVE" | "PAUSED" | "COMPLETED" | "ABANDONED";
export type GoalCategoryDTO = "ROUTINE" | "EXECUTION" | "RISK" | "JOURNAL" | "MINDSET" | "OTHER";

export interface GoalRequirementDTO {
  id: string;
  type: GoalRequirementType;
  title: string;
  label: string | null;
  mandatory: boolean;
}

export interface GoalDayDTO {
  dateKey: string;
  status: LiveGoalDayStatus;
  final: boolean;
  attempt: number;
  streakAfter: number;
  results: {
    requirementId: string;
    type: GoalRequirementType;
    title: string;
    mandatory: boolean;
    result: RequirementResult;
    reasons: string[];
  }[];
}

export interface ActiveGoalDTO {
  id: string;
  name: string;
  description: string | null;
  category: GoalCategoryDTO;
  status: "ACTIVE" | "PAUSED";
  startDate: string;
  targetDays: number;
  /** Requirements in force today (or on the start date, before it begins). */
  requirements: GoalRequirementDTO[];
  /** Live consecutive streak of the current attempt. */
  currentStreak: number;
  longestStreak: number;
  successfulDays: number;
  missedDays: number;
  attempt: number;
  attemptStartedOn: string | null;
  /** Of the current attempt — never of the historical total. */
  progressPercent: number;
  remainingDays: number;
  /** If every remaining trading day qualifies. */
  projectedCompletion: string | null;
  started: boolean;
  today: GoalDayDTO | null;
  /** Oldest first, from the start date to today. */
  days: GoalDayDTO[];
  pause: { pausedSince: string | null; daysUsed: number; daysLeft: number; limit: number };
}

export interface GoalHistoryDTO {
  id: string;
  name: string;
  category: GoalCategoryDTO;
  status: "COMPLETED" | "ABANDONED";
  targetDays: number;
  startDate: string;
  /** Completion date, or the abandonment date. */
  endedOn: string;
  longestStreak: number;
  successfulDays: number;
  missedDays: number;
  attempts: number;
}

export interface PersonalStreakDTO {
  /** The active goal's live consecutive streak (0 without one). */
  current: number;
  /** Longest consecutive streak across every goal; never decreases. */
  longest: number;
  /** Qualifying days across every goal. */
  successfulDays: number;
  goalsCompleted: number;
  goalsAbandoned: number;
}

export interface GoalsOverviewDTO {
  todayKey: string;
  active: ActiveGoalDTO | null;
  history: GoalHistoryDTO[];
  stats: PersonalStreakDTO;
}
