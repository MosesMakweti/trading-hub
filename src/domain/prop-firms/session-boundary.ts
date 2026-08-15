/**
 * Trading-day bucketing that respects each account's configured reset
 * timezone/hour (spec §7: "Daily-loss calculations must respect the
 * configured reset timezone/session boundary"). Pure date math — no Prisma,
 * no I/O. Falls back to UTC 00:00 when an account has no configured
 * timezone/hour (PropFirmAccount.dailyResetTimezone/dailyResetHour).
 */

/** Minutes east of UTC for a small set of common trading-firm timezones.
 *  Deliberately NOT full IANA/DST-aware conversion (no extra dependency) —
 *  a fixed offset is what every prop firm's published daily-reset time
 *  actually means in practice (e.g. "5pm New York" as a nominal cutoff,
 *  not a DST-tracking instant). Unrecognized/omitted timezones fall back to
 *  UTC, which is always correct for UTC-denominated firms. */
const FIXED_OFFSET_MINUTES: Record<string, number> = {
  UTC: 0,
  "America/New_York": -5 * 60, // EST (no DST tracking — see note above)
  "America/Chicago": -6 * 60,
  "America/Denver": -7 * 60,
  "America/Los_Angeles": -8 * 60,
  "Europe/London": 0,
  "Europe/Berlin": 1 * 60,
  "Asia/Singapore": 8 * 60,
  "Australia/Sydney": 10 * 60,
};

function offsetMinutesFor(timezone: string | null): number {
  if (!timezone) return 0;
  return FIXED_OFFSET_MINUTES[timezone] ?? 0;
}

/** Returns a stable "trading day" bucket key (YYYY-MM-DD, in the account's
 *  reset-boundary-local time) for a given instant. Two instants land in the
 *  same bucket iff they fall in the same [resetHour, resetHour+24h) window,
 *  local to the configured timezone. */
export function tradingDayKeyFor(date: Date, timezone: string | null, resetHour: number): string {
  const offsetMs = offsetMinutesFor(timezone) * 60_000;
  const resetMs = resetHour * 60 * 60_000;
  // Shift the instant into "local time," then subtract the reset hour so
  // the boundary itself becomes local midnight — after that, taking the
  // UTC calendar date of the shifted instant gives the correct bucket.
  const shifted = new Date(date.getTime() + offsetMs - resetMs);
  return shifted.toISOString().slice(0, 10);
}

/** True when two instants fall in the same trading-day bucket. */
export function isSameTradingDay(a: Date, b: Date, timezone: string | null, resetHour: number): boolean {
  return tradingDayKeyFor(a, timezone, resetHour) === tradingDayKeyFor(b, timezone, resetHour);
}

/** Groups items into trading-day buckets by a date accessor, preserving each
 *  bucket's items in original order. Used by daily-loss/consistency
 *  evaluators to sum one day's ledger entries or executions at a time. */
export function groupByTradingDay<T>(items: T[], dateOf: (item: T) => Date, timezone: string | null, resetHour: number): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = tradingDayKeyFor(dateOf(item), timezone, resetHour);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return buckets;
}
