const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_PATTERN.test(key)) return false;
  const [year, month, day] = key.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Round-trips Postgres `@db.Date` columns, which the driver returns as
 * UTC-midnight `Date` objects, to/from "YYYY-MM-DD" keys. Never use this on
 * a `Date` representing a real instant (e.g. `new Date()`) — see
 * `localDateToKey` for that.
 */
export function utcDateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateKeyToUtcDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Pure UTC arithmetic (never local getters/setters) so a day offset can't
// shift by one when the server's local timezone isn't UTC.
export function addDaysToKey(key: string, delta: number): string {
  const date = dateKeyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + delta);
  return utcDateToKey(date);
}

// Formats a date key for display, pinning the formatter to UTC so it always
// reflects the stored Y/M/D regardless of the server's local timezone.
export function formatDateKeyLong(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(dateKeyToUtcDate(key));
}

/**
 * "What day is it right now, on the browser's local calendar?" Deliberately
 * uses local getters instead of `toISOString` — converting a local `Date`
 * via UTC would shift the day near midnight for anyone west of UTC.
 */
export function localDateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Trade execution time is stored as minutes-since-midnight (0-1439), not a
// Time/DateTime — trivially sortable and sidesteps timezone handling for a
// value that's really just "what time of day."
export function minutesToTimeString(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
