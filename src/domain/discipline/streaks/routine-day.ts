/**
 * 🔥 Daily Routine — what makes a "complete routine day" (pure).
 *
 * A routine day is complete only when BOTH halves of the trader's daily
 * routine were done, on time:
 *
 *  1. PRE-SESSION — the Pre-Session Routine readiness gate was passed. The
 *     server only allows readiness once EVERY required (mandatory) routine
 *     item is complete (today-routine.service `setRoutineReady`), so a
 *     partially completed routine can never reach this state. The fact used
 *     is the write-once `routineFirstReadyAt` (legacy days: `routineReadyAt`),
 *     and it must fall on the day itself — readying an old day later never
 *     back-fills a streak.
 *  2. POST-SESSION — the day was closed (Close Trading Day / "Mark day
 *     reviewed" → write-once `analyzedAt`) with a written daily reflection
 *     (any of went well / to improve / main lesson / focus for next session),
 *     no later than the next local date (journaling after midnight is fine;
 *     a week later is not).
 *
 * Trades play no part: a correctly flat day is a complete routine day.
 */
import { DEFAULT_PREPARATION_SCHEDULE, dayApplicability, type PreparationDayException, type PreparationScheduleVersion } from "../preparation-schedule";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";

/** How many local dates after the day the post-session close may still land. */
export const ROUTINE_CLOSE_GRACE_DAYS = 1;

export interface RoutineDayFacts {
  dateKey: string;
  /** Trader-local date of the first readiness confirmation (null = never readied). */
  readyDateKey: string | null;
  /** Trader-local date the day was closed / marked reviewed (null = never). */
  closedDateKey: string | null;
  /** At least one daily reflection field has text. */
  hasReflection: boolean;
}

export interface RoutineDayEvaluation {
  preSession: boolean;
  postSession: boolean;
  complete: boolean;
}

export function evaluateRoutineDay(f: RoutineDayFacts): RoutineDayEvaluation {
  const preSession = f.readyDateKey != null && f.readyDateKey <= f.dateKey;
  const closeDeadline = addDaysToDateKey(f.dateKey, ROUTINE_CLOSE_GRACE_DAYS);
  const postSession = f.closedDateKey != null && f.closedDateKey <= closeDeadline && f.hasReflection;
  return { preSession, postSession, complete: preSession && postSession };
}

/**
 * Whether a date OWES a routine:
 *   REQUIRED  a scheduled trading weekday (or a valid EXTRA_DAY) — missing it breaks the streak
 *   OPTIONAL  not scheduled — completing it still counts, skipping it is free
 *   EXEMPT    a DAY_OFF booked in advance — never counts against the trader
 *
 * The trader's Preparation Schedule (Settings → Routine) is the single source
 * of which weekdays are trading days, with its audited exception rules
 * (an exception only counts if created before that day's target). Before a
 * schedule exists, Monday–Friday is assumed.
 */
export type DayRequirement = "REQUIRED" | "OPTIONAL" | "EXEMPT";

export function routineDayRequirement(
  versions: readonly PreparationScheduleVersion[],
  exceptions: readonly PreparationDayException[],
  dateKey: string,
  defaultWeekdays: readonly number[] = DEFAULT_PREPARATION_SCHEDULE.weekdays,
): DayRequirement {
  const a = dayApplicability(versions, exceptions, dateKey);
  switch (a.kind) {
    case "SCHEDULED":
      return "REQUIRED";
    case "DAY_OFF":
      return "EXEMPT";
    case "NOT_SCHEDULED":
      return "OPTIONAL";
    case "OUTSIDE_ERA": {
      const [y, m, d] = dateKey.split("-").map(Number);
      return defaultWeekdays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) ? "REQUIRED" : "OPTIONAL";
    }
  }
}
