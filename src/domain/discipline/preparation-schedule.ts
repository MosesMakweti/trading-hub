/**
 * Preparation Schedule — which local dates are scheduled trading days, and
 * the frozen target / cutoff instants for each (Phase 1, pure).
 *
 * Versions are immutable and dated by LOCAL date: a version governs every
 * date from its `effectiveFrom` until the next version's. A change is always
 * a new version effective from the NEXT local date (`nextEffectiveDate`), so
 * nothing about today or the past ever moves. Dates before the first
 * version are outside the scoring era: never scored, never missed.
 *
 * v1 limits (approved): one Preparation per local date; the target and the
 * cutoff stay within that local date (no overnight targets).
 */
import { addDaysToDateKey, isValidTimeZone, localDateTimeAt, localTimeToInstant, weekdayOfDateKey } from "@/domain/time/trader-calendar";
import { validateScoringRules, type PreparationScoringRules } from "./preparation-config";

export interface PreparationScheduleVersion {
  id: string;
  /** First LOCAL date this version governs (YYYY-MM-DD). */
  effectiveFrom: string;
  /** IANA zone frozen with the version. */
  timezone: string;
  /** Target preparation time, local minutes since midnight (0–1439). */
  targetMinutes: number;
  /** Scheduled weekdays, 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  rules: PreparationScoringRules;
  createdAt: Date;
}

/**
 * Prefill for a trader who has not confirmed a schedule yet: 08:00 local,
 * Monday–Friday. Only a suggestion — nothing is scored until confirmed.
 */
export const DEFAULT_PREPARATION_SCHEDULE: Readonly<{ targetMinutes: number; weekdays: readonly number[] }> = {
  targetMinutes: 8 * 60,
  weekdays: [1, 2, 3, 4, 5],
};

export type PreparationExceptionKind = "DAY_OFF" | "EXTRA_DAY";

export interface PreparationDayException {
  dateKey: string;
  kind: PreparationExceptionKind;
  createdAt: Date;
}

export function validateScheduleVersion(v: Omit<PreparationScheduleVersion, "id" | "createdAt">): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom)) errors.push("effectiveFrom must be a YYYY-MM-DD date.");
  if (!isValidTimeZone(v.timezone)) errors.push("timezone must be a valid IANA zone.");
  if (!Number.isInteger(v.targetMinutes) || v.targetMinutes < 0 || v.targetMinutes > 1439) errors.push("targetMinutes must be 0–1439.");
  if (v.weekdays.length === 0) errors.push("choose at least one trading weekday.");
  if (v.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(v.weekdays).size !== v.weekdays.length) {
    errors.push("weekdays must be distinct values 0–6.");
  }
  errors.push(...validateScoringRules(v.rules));
  return errors;
}

/** A schedule change confirmed on `traderTodayKey` governs from the next local date. */
export function nextEffectiveDate(traderTodayKey: string): string {
  return addDaysToDateKey(traderTodayKey, 1);
}

/** The version governing `dateKey`, or null before the scoring era. Ties on effectiveFrom → latest createdAt. */
export function scheduleVersionFor(versions: readonly PreparationScheduleVersion[], dateKey: string): PreparationScheduleVersion | null {
  let best: PreparationScheduleVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > dateKey) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.createdAt > best.createdAt)) best = v;
  }
  return best;
}

/** First date of the scoring era (earliest effectiveFrom), or null when no schedule exists. */
export function scoringEraStart(versions: readonly PreparationScheduleVersion[]): string | null {
  return versions.reduce<string | null>((min, v) => (min == null || v.effectiveFrom < min ? v.effectiveFrom : min), null);
}

export interface DayInstants {
  targetAt: Date;
  cutoffAt: Date;
}

/**
 * Target and cutoff for `dateKey` under `version`, as UTC instants.
 *   targetAt = the local target wall time on that date (DST-aware; a target
 *              inside a spring-forward gap resolves to just after the gap)
 *   cutoffAt = min(targetAt + cutoffAfterTargetMinutes elapsed,
 *                  the local cap minute on the same date)
 */
export function dayInstants(version: PreparationScheduleVersion, dateKey: string): DayInstants {
  const targetAt = localTimeToInstant(dateKey, version.targetMinutes, version.timezone);
  const byOffset = targetAt.getTime() + version.rules.cutoffAfterTargetMinutes * 60_000;
  const cap = localTimeToInstant(dateKey, version.rules.cutoffCapLocalMinutes, version.timezone).getTime();
  // The cap must stay on the same local date (a DST gap can never push it off; guard anyway).
  const capOk = localDateTimeAt(new Date(cap), version.timezone).dateKey === dateKey;
  const cutoff = Math.max(targetAt.getTime(), Math.min(byOffset, capOk ? cap : byOffset));
  return { targetAt, cutoffAt: new Date(cutoff) };
}

export type DayApplicability =
  | { kind: "OUTSIDE_ERA" }
  | { kind: "NOT_SCHEDULED"; version: PreparationScheduleVersion }
  | { kind: "DAY_OFF"; version: PreparationScheduleVersion; instants: DayInstants }
  | { kind: "SCHEDULED"; version: PreparationScheduleVersion; instants: DayInstants; viaExtraDay: boolean };

/**
 * Is `dateKey` a scheduled preparation day?
 *   • before the first version → OUTSIDE_ERA (no retroactive scoring)
 *   • a scheduled weekday, or an EXTRA_DAY exception → SCHEDULED
 *   • exceptions count only if created BEFORE that day's target instant
 *     (at the target or later is too late): a late DAY_OFF cannot erase a
 *     miss, and a late EXTRA_DAY cannot pad a streak — history changes go
 *     through audited corrections
 *   • otherwise → NOT_SCHEDULED (never affects the streak)
 */
export function dayApplicability(
  versions: readonly PreparationScheduleVersion[],
  exceptions: readonly PreparationDayException[],
  dateKey: string,
): DayApplicability {
  const version = scheduleVersionFor(versions, dateKey);
  if (!version) return { kind: "OUTSIDE_ERA" };
  const onDate = exceptions.filter((e) => e.dateKey === dateKey);
  const instants = dayInstants(version, dateKey);
  const inAdvance = (e: PreparationDayException) => e.createdAt.getTime() < instants.targetAt.getTime();
  const weekdayScheduled = version.weekdays.includes(weekdayOfDateKey(dateKey));
  const extra = onDate.some((e) => e.kind === "EXTRA_DAY" && inAdvance(e));
  if (!weekdayScheduled && !extra) return { kind: "NOT_SCHEDULED", version };
  const validDayOff = onDate.some((e) => e.kind === "DAY_OFF" && inAdvance(e));
  if (validDayOff) return { kind: "DAY_OFF", version, instants };
  return { kind: "SCHEDULED", version, instants, viaExtraDay: !weekdayScheduled && extra };
}
