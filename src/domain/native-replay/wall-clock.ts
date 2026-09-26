/**
 * Native Replay — dataset wall-clock time.
 *
 * MT5 bar exports carry the BROKER SERVER's wall-clock date/time and no
 * timezone metadata. Native Replay therefore never converts them to an
 * instant: a bar's time is stored and computed as a **wall-clock minute** —
 * whole minutes since 1970-01-01 00:00 *on the dataset's own clock*. It is
 * not a UTC instant and must never be handed to `new Date()` as one for
 * display in the viewer's timezone.
 *
 * All arithmetic here is plain integer math (plus `Date.UTC`/`getUTC*` used
 * purely as a calendar calculator, which is independent of the host's
 * timezone), so candle boundaries can never depend on where the code runs.
 */

/** Minutes since 1970-01-01 00:00 on the dataset's wall clock. */
export type WallClockMinute = number;

export const MINUTES_PER_DAY = 1440;

/** Sane bounds for historical market data (also keeps minutes well inside int32). */
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2100;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, month1: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month1 - 1];
}

/** Calendar-valid components → wall-clock minute, or null (never rolls over
 *  an out-of-range component the way `Date.UTC` silently would). */
export function wallClockMinuteOf(y: number, month1: number, d: number, h: number, mi: number): WallClockMinute | null {
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  if (month1 < 1 || month1 > 12 || d < 1 || d > daysInMonth(y, month1)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return Math.floor(Date.UTC(y, month1 - 1, d, h, mi) / 60_000);
}

export interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday, on the dataset's wall clock. */
  weekday: number;
}

export function partsOf(m: WallClockMinute): WallClockParts {
  const d = new Date(m * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" — deliberately no "Z"/offset: this is wall-clock time
 *  in the dataset's time basis, not an instant. */
export function formatWallClock(m: WallClockMinute): string {
  const p = partsOf(m);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** Parses "YYYY-MM-DDTHH:mm" (as produced by `formatWallClock`). */
export function parseWallClock(value: string): WallClockMinute | null {
  const m = WALL_CLOCK_PATTERN.exec(value.trim());
  if (!m) return null;
  return wallClockMinuteOf(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

export function weekdayOf(m: WallClockMinute): number {
  // 1970-01-01 was a Thursday (4).
  return (((Math.floor(m / MINUTES_PER_DAY) + 4) % 7) + 7) % 7;
}
