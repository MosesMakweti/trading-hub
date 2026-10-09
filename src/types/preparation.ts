/**
 * Preparation Score — UI transport types (Phase 3).
 *
 * The server/client boundary for Preparation. Everything here is plain JSON:
 * instants are ISO-8601 strings, dates are `YYYY-MM-DD` keys, and every
 * score, status and streak value is copied verbatim from the canonical
 * read model (`preparation.service.ts` → `preparation.mapper.ts`). React
 * formats these values; it never derives a score, status or streak.
 */
import type { PreparationStatus } from "@/domain/discipline";

export type PreparationScheduleDTO = {
  timezone: string;
  /** Local minutes since midnight in `timezone`. */
  targetMinutes: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  effectiveFrom: string;
};

export type PreparationTodayDTO =
  /** Schedule confirmed but not started yet (`startsOn` = its first date). */
  | { kind: "OUTSIDE_ERA"; startsOn: string | null }
  | { kind: "NOT_SCHEDULED" }
  | { kind: "DAY_OFF" }
  | {
      kind: "PENDING";
      targetAt: string;
      cutoffAt: string;
      /** Server-computed at `serverNow` (negative once past the target). */
      minutesToTarget: number;
      requiredTotal: number;
      requiredDone: number;
    }
  | {
      kind: "SCORED";
      status: PreparationStatus;
      score: number;
      completionPoints: number;
      timingPoints: number;
      completionMax: number;
      timingMax: number;
      requiredTotal: number;
      requiredDone: number;
      targetAt: string;
      cutoffAt: string;
      readyAt: string | null;
      /** Rounded display minutes, negative = early; null when not ready by the cutoff. */
      deviationMinutes: number | null;
      bandLabel: string | null;
      /** An audited correction in effect (the original record is unchanged). */
      corrected: { status: PreparationStatus; score: number } | null;
    };

export type PreparationStreakDTO = {
  current: number;
  longest: number;
  /** True only on the date whose outcome started a new streak after a break. */
  restartedToday: boolean;
};

export type PreparationNoticeDTO = {
  recordId: string;
  dateKey: string;
  status: "INCOMPLETE" | "MISSED";
  endedLength: number;
  longest: number;
};

export type PreparationViewDTO = {
  configured: true;
  /** The server instant the view was built at (ISO). Presentation clocks anchor to it. */
  serverNow: string;
  todayKey: string;
  /** The zone today's target/ready times are shown in (the schedule's frozen zone). */
  timezone: string;
  schedule: PreparationScheduleDTO | null;
  pendingSchedule: PreparationScheduleDTO | null;
  today: PreparationTodayDTO;
  streak: PreparationStreakDTO;
  notice: PreparationNoticeDTO | null;
};

/** No Preparation Schedule → Today shows nothing Preparation-related. */
export type PreparationUnconfiguredDTO = { configured: false };

export type PreparationDTO = PreparationViewDTO | PreparationUnconfiguredDTO;

/** Settings → Routine → Preparation Schedule. */
export type PreparationSettingsDTO = {
  todayKey: string;
  /** The date a change saved now takes effect. */
  nextEffectiveFrom: string;
  current: PreparationScheduleDTO | null;
  upcoming: PreparationScheduleDTO | null;
  /** Prefill for a trader without a schedule yet. */
  defaults: { targetMinutes: number; weekdays: number[] };
  trader: { timezone: string; configured: boolean; pendingTimezone: string | null };
  upcomingExceptions: { id: string; dateKey: string; kind: "DAY_OFF" | "EXTRA_DAY"; note: string | null }[];
};
