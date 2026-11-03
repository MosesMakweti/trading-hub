/**
 * Discipline Streaks — serializable view models (server → client).
 * Plain JSON only: dates are YYYY-MM-DD keys or ISO strings. Every number
 * here was derived on the server from persisted records; the UI only formats.
 */
import type { StreakDayStatus, TrackKey } from "@/domain/discipline/streaks";

export type { StreakDayStatus, TrackKey };

export interface StreakTrackDTO {
  key: TrackKey;
  current: number;
  longest: number;
  /** Lifetime credits: routine days / reviewed trades / perfectly followed trades. */
  total: number;
  /** Distinct credited dates (for review/adherence this differs from total). */
  activeDays: number;
  todayStatus: StreakDayStatus;
  /** True when today already extended the streak. */
  creditedToday: boolean;
  lastActiveOn: string | null;
  currentStartedOn: string | null;
  lastBreak: { dateKey: string; endedLength: number } | null;
  milestone: { target: number | null; previous: number; remaining: number; fraction: number };
  /** The milestone the current streak sits exactly on (celebrate), if any. */
  milestoneReached: number | null;
}

export interface DisciplineCalendarDayDTO {
  dateKey: string;
  requirement: "REQUIRED" | "OPTIONAL" | "EXEMPT";
  routine: StreakDayStatus;
  review: StreakDayStatus;
  adherence: StreakDayStatus;
  routinePreSession: boolean;
  routinePostSession: boolean;
  reviewsCompleted: number;
  reviewsOutstanding: number;
  tradesExecuted: number;
  perfectTrades: number;
  tradesAwaitingReview: number;
}

export interface AchievementDTO {
  key: string;
  track: TrackKey;
  title: string;
  description: string;
  target: number;
  progress: number;
  unlocked: boolean;
  /** Local date the threshold was met. */
  achievedOn: string | null;
  unlockedAt: string | null;
  /** Unlocked but its celebration not dismissed yet. */
  isNew: boolean;
}

export interface DisciplineOverviewDTO {
  todayKey: string;
  timezone: string;
  tracks: Record<TrackKey, StreakTrackDTO>;
  today: {
    requirement: "REQUIRED" | "OPTIONAL" | "EXEMPT";
    routinePreSession: boolean;
    routinePostSession: boolean;
    reviewsOutstanding: number;
    tradesAwaitingReview: number;
  };
  /** Trading days whose adherence is still waiting for a final review. */
  adherencePendingDays: number;
  calendar: DisciplineCalendarDayDTO[];
  achievements: AchievementDTO[];
}

/** Returned by actions that can move a streak, for one quiet toast. */
export interface DisciplineFeedbackDTO {
  kind: "ROUTINE" | "REVIEW";
  routine: { complete: boolean; preSession: boolean; postSession: boolean; streak: number; milestoneReached: number | null } | null;
  review: { counted: boolean; totalReviewed: number; streak: number; milestoneReached: number | null } | null;
  adherence: { perfect: boolean; totalPerfect: number; streak: number; milestoneReached: number | null } | null;
  newAchievements: { key: string; title: string }[];
}
