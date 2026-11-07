/**
 * Goals — day evaluation, attempts, streaks and completion (pure).
 *
 * A goal is a commitment to N CONSECUTIVE qualifying trading days.
 *
 *   QUALIFIED  a scheduled trading day where every mandatory requirement is
 *              MET or NOT_APPLICABLE                         → streak + 1
 *   MISSED     a scheduled trading day where any mandatory requirement is
 *              NOT_MET                                        → streak = 0
 *   REST       not a trading day for this trader (unscheduled weekday,
 *              a day off booked in advance, a date skipped by a timezone
 *              change)                                        → unchanged
 *   PAUSED     the goal was paused                             → unchanged
 *   PENDING    not decided yet (today, or inside the grace period)
 *
 * After a miss the goal stays ACTIVE and a new ATTEMPT starts with the next
 * qualifying day. Goal progress is the current attempt's length, never the
 * historical total. A day is FINAL once it is in the past and decided; the
 * service stores final days (GoalDay) and never re-evaluates them, so later
 * edits to old records cannot rewrite goal history. Days are finalized in
 * date order only, so the stored history is always a contiguous prefix.
 */
import { deriveDailyStreak, type StreakDayStatus } from "@/domain/discipline/streaks/streak";
import type { DayRequirement } from "@/domain/discipline/streaks/routine-day";
import { dateKeysBetween } from "@/domain/discipline/streaks/calendar";
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import {
  evaluateRequirement,
  type GoalActivityFacts,
  type GoalRequirementType,
  type RequirementResult,
} from "./requirements";

export type GoalDayStatus = "QUALIFIED" | "MISSED" | "REST" | "PAUSED";
export type LiveGoalDayStatus = GoalDayStatus | "PENDING";

export interface GoalRequirementVersion {
  id: string;
  type: GoalRequirementType;
  label: string | null;
  mandatory: boolean;
  /** First date the version applies (inclusive). */
  effectiveFrom: string;
  /** First date it no longer applies (null = open-ended). */
  retiredFrom: string | null;
}

export interface GoalPauseInterval {
  fromDate: string;
  /** Exclusive; null = still paused. */
  toDate: string | null;
}

export interface GoalDefinition {
  startDate: string;
  targetDays: number;
  requirements: readonly GoalRequirementVersion[];
  pauses: readonly GoalPauseInterval[];
}

export interface RequirementDayResult {
  requirementId: string;
  type: GoalRequirementType;
  label: string | null;
  mandatory: boolean;
  result: RequirementResult;
  reasons: string[];
}

export interface EvaluatedGoalDay {
  dateKey: string;
  status: LiveGoalDayStatus;
  /** Past and decided: may be stored and will never change. */
  final: boolean;
  results: RequirementDayResult[];
}

/** A day as stored (or about to be stored) in the goal's history. */
export interface GoalDayRecord {
  dateKey: string;
  status: GoalDayStatus;
  attempt: number;
  streakAfter: number;
  results: RequirementDayResult[];
}

export interface GoalDayContext {
  /** Trading-day requirement of a date, from the Preparation Schedule. */
  requirement: (dateKey: string) => DayRequirement;
  /** Dates skipped by a timezone change. */
  skipped: ReadonlySet<string>;
}

export function requirementsOn(def: GoalDefinition, dateKey: string): GoalRequirementVersion[] {
  return def.requirements.filter((r) => r.effectiveFrom <= dateKey && (r.retiredFrom == null || dateKey < r.retiredFrom));
}

export function isPausedOn(pauses: readonly GoalPauseInterval[], dateKey: string): boolean {
  return pauses.some((p) => p.fromDate <= dateKey && (p.toDate == null || dateKey < p.toDate));
}

/** Evaluates one date of a goal against the activity facts. */
export function evaluateGoalDay(def: GoalDefinition, dateKey: string, facts: GoalActivityFacts, ctx: GoalDayContext): EvaluatedGoalDay {
  const past = dateKey < facts.todayKey;
  if (isPausedOn(def.pauses, dateKey)) return { dateKey, status: "PAUSED", final: past, results: [] };
  if (ctx.skipped.has(dateKey) || ctx.requirement(dateKey) !== "REQUIRED") return { dateKey, status: "REST", final: past, results: [] };

  const results: RequirementDayResult[] = requirementsOn(def, dateKey).map((r) => {
    const e = evaluateRequirement(r, dateKey, facts);
    return { requirementId: r.id, type: r.type, label: r.label, mandatory: r.mandatory, result: e.result, reasons: e.reasons };
  });
  const mandatory = results.filter((r) => r.mandatory);
  let status: LiveGoalDayStatus;
  if (mandatory.some((r) => r.result === "NOT_MET")) status = "MISSED";
  else if (mandatory.some((r) => r.result === "PENDING")) status = "PENDING";
  else status = "QUALIFIED";
  return { dateKey, status, final: past && status !== "PENDING", results };
}

/** A day of the live progress: a record whose status may still be PENDING. */
export type GoalProgressDay = Omit<GoalDayRecord, "status"> & { status: LiveGoalDayStatus; final: boolean };

export interface GoalProgress {
  /** Every date from the start to today (or the completion date), oldest first. */
  days: GoalProgressDay[];
  /** Newly final days, in date order, continuing the stored prefix. */
  toFinalize: GoalDayRecord[];
  /** The date whose final day reached the target, if the goal is now complete. */
  completedOn: string | null;
  /** Live consecutive streak of the current attempt (includes today if it already qualifies). */
  currentStreak: number;
  /** Longest attempt of this goal (never decreases: stored days are immutable). */
  longestStreak: number;
  /** Qualifying days in total, across every attempt. */
  successfulDays: number;
  missedDays: number;
  /** Current attempt number (0 before the first qualifying day). */
  attempt: number;
  /** First date of the current attempt (null while the streak is 0). */
  attemptStartedOn: string | null;
  /** Today's live status (null when today is outside the goal). */
  today: EvaluatedGoalDay | null;
}

const STREAK_STATUS: Record<LiveGoalDayStatus, StreakDayStatus> = {
  QUALIFIED: "ACTIVE",
  MISSED: "MISSED",
  REST: "REST",
  PAUSED: "REST",
  PENDING: "PENDING",
};

/**
 * The goal's full progress: stored history (`stored`, a contiguous prefix
 * from the start date) followed by freshly evaluated days up to today.
 */
export function computeGoalProgress(
  def: GoalDefinition,
  stored: readonly GoalDayRecord[],
  facts: GoalActivityFacts,
  ctx: GoalDayContext,
  /** For a closed goal: the last date that belongs to it (completion / abandonment). */
  lastDate?: string,
): GoalProgress {
  const days: GoalProgress["days"] = [];
  const toFinalize: GoalDayRecord[] = [];
  let attempt = 0;
  let streak = 0;
  let completedOn: string | null = null;
  let previous: string | null = null;

  const push = (d: GoalDayRecord, final: boolean, liveStatus: LiveGoalDayStatus) => {
    days.push({ ...d, status: liveStatus, final });
  };

  for (const s of stored) {
    if (previous != null && s.dateKey <= previous) throw new RangeError("Stored goal days must be strictly ascending.");
    previous = s.dateKey;
    attempt = s.attempt;
    streak = s.streakAfter;
    push(s, true, s.status);
    if (s.status === "QUALIFIED" && s.streakAfter >= def.targetDays && completedOn == null) completedOn = s.dateKey;
  }

  const from = previous ? addDaysToDateKey(previous, 1) : def.startDate;
  const until = lastDate && lastDate < facts.todayKey ? lastDate : facts.todayKey;
  let finalizing = true; // only a contiguous run of final days may be stored

  if (completedOn == null) {
    for (const dateKey of dateKeysBetween(from, until)) {
      const e = evaluateGoalDay(def, dateKey, facts, ctx);
      let dayAttempt = attempt;
      let dayStreak = streak;
      if (e.status === "QUALIFIED") {
        if (dayStreak === 0) dayAttempt += 1;
        dayStreak += 1;
      } else if (e.status === "MISSED") {
        dayStreak = 0;
      }
      const record: GoalDayRecord = {
        dateKey,
        status: e.status === "PENDING" ? "REST" : e.status,
        attempt: dayAttempt,
        streakAfter: dayStreak,
        results: e.results,
      };
      if (finalizing && e.final) toFinalize.push(record);
      else finalizing = false;

      if (e.status !== "PENDING") {
        attempt = dayAttempt;
        streak = dayStreak;
      }
      push(record, finalizing && e.final, e.status);
      if (finalizing && e.final && e.status === "QUALIFIED" && dayStreak >= def.targetDays) {
        completedOn = dateKey;
        break;
      }
    }
  }

  const series = days.map((d) => ({ dateKey: d.dateKey, status: STREAK_STATUS[d.status] }));
  const s = deriveDailyStreak(series);
  const todayEntry = days.find((d) => d.dateKey === facts.todayKey);
  const todayEval: EvaluatedGoalDay | null = todayEntry
    ? { dateKey: todayEntry.dateKey, status: todayEntry.status, final: false, results: todayEntry.results }
    : null;

  return {
    days,
    toFinalize,
    completedOn,
    currentStreak: s.current,
    longestStreak: s.longest,
    successfulDays: s.activeDays,
    missedDays: days.filter((d) => d.status === "MISSED").length,
    attempt,
    attemptStartedOn: s.currentStartedOn,
    today: completedOn == null ? todayEval : null,
  };
}

/** Days still needed to complete the goal from the live streak. */
export function remainingDays(targetDays: number, currentStreak: number): number {
  return Math.max(0, targetDays - currentStreak);
}

/** 0–100, of the CURRENT attempt (never the historical total). */
export function progressPercent(targetDays: number, currentStreak: number): number {
  return Math.min(100, Math.round((currentStreak / targetDays) * 100));
}

/**
 * The trader-local date the goal would complete if every remaining trading
 * day qualifies. Scans at most a year ahead; null when no trading day is
 * scheduled in that window.
 */
export function projectedCompletionDate(
  remaining: number,
  todayKey: string,
  todayQualified: boolean,
  isTradingDay: (dateKey: string) => boolean,
): string | null {
  if (remaining === 0) return todayKey;
  let left = remaining;
  let d = todayQualified ? addDaysToDateKey(todayKey, 1) : todayKey;
  for (let i = 0; i < 400; i += 1, d = addDaysToDateKey(d, 1)) {
    if (!isTradingDay(d)) continue;
    left -= 1;
    if (left === 0) return d;
  }
  return null;
}

/** Validates a requirement set: returns the problem, or null when it is usable. */
export function requirementSetProblem(
  reqs: readonly { type: GoalRequirementType; label: string | null; mandatory: boolean }[],
  everyTradingDay: (type: GoalRequirementType) => boolean,
): string | null {
  if (reqs.length === 0) return "Add at least one daily requirement.";
  if (reqs.length > 8) return "A goal can have at most 8 daily requirements.";
  const seen = new Set<string>();
  for (const r of reqs) {
    if (r.type === "CUSTOM_CHECKIN") {
      const label = r.label?.trim() ?? "";
      if (label.length === 0) return "Give each custom check-in a name.";
      const key = `custom:${label.toLowerCase()}`;
      if (seen.has(key)) return "Each custom check-in needs a different name.";
      seen.add(key);
    } else {
      if (seen.has(r.type)) return "Each requirement can only be added once.";
      seen.add(r.type);
    }
  }
  if (!reqs.some((r) => r.mandatory && everyTradingDay(r.type))) {
    return "Include at least one required item that applies on every trading day (routine, day close, journal or a custom check-in), so a quiet day still asks something of you.";
  }
  return null;
}
