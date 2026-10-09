/**
 * Preparation Score — trader-facing wording (Phase 3). Pure and
 * deterministic (no browser/server locale or timezone): the same strings
 * render on the server and after hydration.
 *
 * These helpers only FORMAT canonical values from the read model
 * (status, points, rounded deviation minutes, instants). They never decide
 * a score, a status or a streak.
 */
import type { PreparationStatus } from "@/domain/discipline";
import { addDaysToDateKey, localDateTimeAt } from "@/domain/time/trader-calendar";
import { dateKeyToUtcDate, minutesToTimeString } from "@/lib/date";
import type { PreparationNoticeDTO, PreparationTodayDTO } from "@/types/preparation";

/** 17 → "17 min" · 74 → "1h 14m" · 120 → "2h" (absolute value). */
export function formatDuration(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** The local wall time ("08:17", 24h) of an ISO instant in an IANA zone. */
export function formatLocalTime(iso: string, timeZone: string): string {
  return minutesToTimeString(localDateTimeAt(new Date(iso), timeZone).minutesOfDay);
}

/** A local-minutes target ("08:00"). */
export function formatTargetMinutes(minutes: number): string {
  return minutesToTimeString(minutes);
}

const STATUS_LABEL: Record<PreparationStatus, string> = {
  VERY_EARLY: "Very early",
  EARLY: "Early",
  ON_TIME: "On time",
  LATE: "Late",
  VERY_LATE: "Very late",
  INCOMPLETE: "Incomplete",
  MISSED: "Missed",
  DAY_OFF: "Day off",
  NOT_SCHEDULED: "Not scheduled",
};

export function statusLabel(status: PreparationStatus): string {
  return STATUS_LABEL[status];
}

/**
 * Concise timing words for a canonical status + rounded deviation:
 * "On time", "Very early", "12 min early", "17 min late", "1h 14m late",
 * "Missed cutoff", "Missed".
 */
export function timingPhrase(status: PreparationStatus, deviationMinutes: number | null): string {
  switch (status) {
    case "ON_TIME":
      return "On time";
    case "VERY_EARLY":
      return "Very early";
    case "INCOMPLETE":
      return "Missed cutoff";
    case "MISSED":
      return "Missed";
    case "DAY_OFF":
    case "NOT_SCHEDULED":
      return STATUS_LABEL[status];
    default:
      if (deviationMinutes == null || deviationMinutes === 0) return "On time";
      return `${formatDuration(deviationMinutes)} ${deviationMinutes < 0 ? "early" : "late"}`;
  }
}

/** "+17 min" · "−12 min" · "0 min" — the breakdown's deviation row. */
export function signedDeviation(deviationMinutes: number): string {
  if (deviationMinutes === 0) return "0 min";
  return `${deviationMinutes > 0 ? "+" : "−"}${formatDuration(deviationMinutes)}`;
}

/** The one-line summary under a finalized score. */
export function scoredSummary(today: Extract<PreparationTodayDTO, { kind: "SCORED" }>): string {
  const status = today.corrected?.status ?? today.status;
  if (status === "MISSED") return "Pre-session routine missed";
  if (status === "INCOMPLETE") return `${today.requiredDone} of ${today.requiredTotal} required · Missed cutoff`;
  if (status === "ON_TIME") return "On time · Routine complete";
  return `Routine complete · ${timingPhrase(status, today.deviationMinutes)}`;
}

/** Before readiness: "25 min remaining" · "Target time" · "12 min late". */
export function pendingContext(minutesToTarget: number): string {
  if (minutesToTarget > 0) return `${formatDuration(minutesToTarget)} remaining`;
  if (minutesToTarget === 0) return "Target time";
  return `${formatDuration(minutesToTarget)} late`;
}

/** Minutes until an ISO instant at `nowMs`, with the read model's rounding (ceil). */
export function minutesUntil(iso: string, nowMs: number): number {
  return Math.ceil((Date.parse(iso) - nowMs) / 60_000);
}

/** Monday-first weekday order for selectors (0 = Sunday … 6 = Saturday). */
export const WEEKDAYS_MONDAY_FIRST: readonly { day: number; short: string; letter: string; name: string }[] = [
  { day: 1, short: "Mon", letter: "M", name: "Monday" },
  { day: 2, short: "Tue", letter: "T", name: "Tuesday" },
  { day: 3, short: "Wed", letter: "W", name: "Wednesday" },
  { day: 4, short: "Thu", letter: "T", name: "Thursday" },
  { day: 5, short: "Fri", letter: "F", name: "Friday" },
  { day: 6, short: "Sat", letter: "S", name: "Saturday" },
  { day: 0, short: "Sun", letter: "S", name: "Sunday" },
];

/**
 * "Mon–Fri" · "Sun–Thu" · "Every day" · "Mon, Wed, Fri" · "Sat, Sun".
 * A run of 3+ consecutive days is a range, including one that wraps the
 * week (Sun–Thu); anything else is listed Monday-first.
 */
export function weekdaysSummary(weekdays: readonly number[]): string {
  const set = new Set(weekdays);
  if (set.size === 7) return "Every day";
  if (set.size === 0) return "No days";
  const order = WEEKDAYS_MONDAY_FIRST.map((w) => w.day);
  const on = order.map((d) => set.has(d));
  const short = (i: number) => WEEKDAYS_MONDAY_FIRST[i].short;
  // Run starts: selected days whose previous day (cyclically) is not selected.
  const starts = on.flatMap((v, i) => (v && !on[(i + 6) % 7] ? [i] : []));
  if (starts.length === 1 && set.size >= 3) return `${short(starts[0])}–${short((starts[0] + set.size - 1) % 7)}`;
  return on.flatMap((v, i) => (v ? [short(i)] : [])).join(", ");
}

/** "Fri, Oct 10" for a date key (calendar date, timezone-independent). */
export function formatDateKeyCompact(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(dateKeyToUtcDate(dateKey));
}

/** "Oct 12" for a date key. */
export function formatDateKeyMonthDay(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dateKeyToUtcDate(dateKey));
}

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The factual streak-break notice. No judgement — what ended and why:
 *   "Your 14-day Preparation Streak ended"
 *   "Monday's pre-session routine wasn't completed."
 */
export function breakNoticeText(notice: PreparationNoticeDTO, todayKey: string): { headline: string; detail: string; best: string } {
  let when: string;
  if (addDaysToDateKey(notice.dateKey, 1) === todayKey) when = "Yesterday's";
  else if (notice.dateKey === todayKey) when = "Today's";
  else if (addDaysToDateKey(notice.dateKey, 7) > todayKey) when = `${WEEKDAY_LONG[dateKeyToUtcDate(notice.dateKey).getUTCDay()]}'s`;
  else when = `The ${formatDateKeyMonthDay(notice.dateKey)}`;
  const detail =
    notice.status === "INCOMPLETE"
      ? `${when} pre-session routine wasn't completed before the cutoff.`
      : `${when} pre-session routine wasn't completed.`;
  return {
    headline: `Your ${notice.endedLength}-day Preparation Streak ended`,
    detail,
    best: `Best streak: ${notice.longest} ${notice.longest === 1 ? "day" : "days"}`,
  };
}

/** "14 scheduled trading days" / "1 scheduled trading day". */
export function streakDays(n: number): string {
  return `${n} scheduled trading ${n === 1 ? "day" : "days"}`;
}

/**
 * The quiet score feedback after the trader CONFIRMS readiness. `awaiting`
 * is true only between a readiness confirmation and the first refreshed
 * read model after it; a score that appears for any other reason (a page
 * refresh, the cutoff finalizing the day) gets no feedback. Never for an
 * INCOMPLETE / MISSED result — readiness can't produce one before the
 * cutoff, and a success-style message for a missed day would be wrong.
 */
export function readinessFeedback(
  awaiting: boolean,
  today: PreparationTodayDTO | undefined,
  restartedToday: boolean,
): { title: string; description: string } | null {
  if (!awaiting || today?.kind !== "SCORED") return null;
  const status = today.corrected?.status ?? today.status;
  if (status === "INCOMPLETE" || status === "MISSED") return null;
  const summary = scoredSummary(today);
  return {
    title: `Preparation ${today.corrected?.score ?? today.score}/100`,
    description: restartedToday ? `${summary} · New Preparation Streak started.` : summary,
  };
}
