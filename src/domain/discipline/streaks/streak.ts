/**
 * Discipline Streaks — the generic daily streak engine (pure).
 *
 * Every streak in the Discipline system (🔥 routine, 📝 review, 🎯 plan
 * adherence) is DERIVED from a day series, never a stored counter. Each local
 * date carries exactly one status, so a date can never add to a streak twice:
 *
 *   ACTIVE   the date satisfied the track's rule              → streak + 1
 *   MISSED   the date was owed and not satisfied               → streak = 0
 *   REST     nothing was owed (day off, no-trade day, nothing
 *            to review, a date skipped by a timezone change)   → unchanged
 *   PENDING  still open (today) or awaiting the trader's own
 *            assessment                                        → unchanged
 *
 * REST and PENDING never break a streak, which is what lets a trader take a
 * legitimate no-trade day without losing anything.
 */

export type StreakDayStatus = "ACTIVE" | "MISSED" | "REST" | "PENDING";

export interface StreakDay {
  /** Local date on the trader's calendar (YYYY-MM-DD). */
  dateKey: string;
  status: StreakDayStatus;
}

export interface StreakRun {
  startedOn: string;
  endedOn: string;
  length: number;
}

export interface DailyStreak {
  current: number;
  longest: number;
  /** First date of the current run (null when current = 0). */
  currentStartedOn: string | null;
  /** Last date of the (most recent) longest run. */
  longestEndedOn: string | null;
  lastActiveOn: string | null;
  /** Total ACTIVE dates ever. */
  activeDays: number;
  /** The most recent MISSED date that ended a run of ≥ 1, if any. */
  lastBreak: { dateKey: string; endedLength: number } | null;
  /** For each requested threshold already reached: the first date any run reached it. */
  reachedOn: Record<number, string>;
}

/**
 * Derives the streak from a day series. Days must be sorted ascending by
 * dateKey; duplicates are rejected so a caller bug can never double-count.
 */
export function deriveDailyStreak(days: readonly StreakDay[], thresholds: readonly number[] = []): DailyStreak {
  let current = 0;
  let currentStartedOn: string | null = null;
  let longest = 0;
  let longestEndedOn: string | null = null;
  let lastActiveOn: string | null = null;
  let activeDays = 0;
  let lastBreak: DailyStreak["lastBreak"] = null;
  const reachedOn: Record<number, string> = {};
  let previous: string | null = null;

  for (const day of days) {
    if (previous != null && day.dateKey <= previous) {
      throw new RangeError(`Streak days must be strictly ascending (got ${day.dateKey} after ${previous}).`);
    }
    previous = day.dateKey;

    if (day.status === "ACTIVE") {
      if (current === 0) currentStartedOn = day.dateKey;
      current += 1;
      activeDays += 1;
      lastActiveOn = day.dateKey;
      if (current >= longest) {
        longest = current;
        longestEndedOn = day.dateKey;
      }
      for (const t of thresholds) if (current === t && reachedOn[t] == null) reachedOn[t] = day.dateKey;
    } else if (day.status === "MISSED") {
      if (current > 0) lastBreak = { dateKey: day.dateKey, endedLength: current };
      current = 0;
      currentStartedOn = null;
    }
  }

  return { current, longest, currentStartedOn, longestEndedOn, lastActiveOn, activeDays, lastBreak, reachedOn };
}

/** Every run of consecutive credited dates (REST/PENDING inside a run keep it alive). */
export function streakRuns(days: readonly StreakDay[]): StreakRun[] {
  const runs: StreakRun[] = [];
  let open: StreakRun | null = null;
  for (const day of days) {
    if (day.status === "ACTIVE") {
      if (open) {
        open.endedOn = day.dateKey;
        open.length += 1;
      } else {
        open = { startedOn: day.dateKey, endedOn: day.dateKey, length: 1 };
        runs.push(open);
      }
    } else if (day.status === "MISSED") {
      open = null;
    }
  }
  return runs;
}
