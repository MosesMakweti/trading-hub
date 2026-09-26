/**
 * Native Replay — supported timeframes and candle boundaries.
 *
 * M1 is the only stored resolution; every other timeframe is derived. All
 * boundaries are on the DATASET's wall clock (broker/server time for MT5
 * exports) — never the viewer's, the host's, or UTC unless the data is UTC.
 *
 * - Intraday (M1…H12): every length divides a 24h day, so a bucket starts at
 *   `floor(minute / length) * length` — equivalently, anchored to server
 *   midnight (H4 = 00:00, 04:00, 08:00 …; H6 = 00:00, 06:00 …), the same way
 *   MT5 builds its own intraday bars.
 * - D1: one server calendar day, 00:00–23:59.
 * - W1: starts **Sunday 00:00** server time and spans 7 days (MT5's own W1
 *   convention — its weekly bars are stamped on Sunday). Sunday-evening
 *   session opens therefore belong to the week they start.
 * - MN1: server calendar month, from the 1st 00:00 to the end of its last day.
 */
import { MINUTES_PER_DAY, partsOf, wallClockMinuteOf, weekdayOf, type WallClockMinute } from "./wall-clock";

export const REPLAY_TIMEFRAMES = [
  "M1", "M2", "M3", "M5", "M10", "M15", "M30",
  "H1", "H2", "H4", "H6", "H8", "H12",
  "D1", "W1", "MN1",
] as const;

export type ReplayTimeframe = (typeof REPLAY_TIMEFRAMES)[number];

/** Minutes per bucket for the fixed-length timeframes (D1 is fixed too on a
 *  wall clock — there is no DST on a timezone-less clock). */
const FIXED_MINUTES: Record<Exclude<ReplayTimeframe, "W1" | "MN1">, number> = {
  M1: 1, M2: 2, M3: 3, M5: 5, M10: 10, M15: 15, M30: 30,
  H1: 60, H2: 120, H4: 240, H6: 360, H8: 480, H12: 720,
  D1: MINUTES_PER_DAY,
};

export function isReplayTimeframe(value: string): value is ReplayTimeframe {
  return (REPLAY_TIMEFRAMES as readonly string[]).includes(value);
}

/** Nominal length in minutes (W1 exact; MN1 approximated as 31 days — only
 *  ever used for sizing fetch windows, never for boundaries). */
export function nominalMinutes(tf: ReplayTimeframe): number {
  if (tf === "W1") return 7 * MINUTES_PER_DAY;
  if (tf === "MN1") return 31 * MINUTES_PER_DAY;
  return FIXED_MINUTES[tf];
}

/** Start (inclusive) of the bucket containing `m`. */
export function bucketStart(m: WallClockMinute, tf: ReplayTimeframe): WallClockMinute {
  if (tf === "W1") {
    const dayStart = Math.floor(m / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    return dayStart - weekdayOf(m) * MINUTES_PER_DAY; // back to Sunday 00:00
  }
  if (tf === "MN1") {
    const p = partsOf(m);
    return wallClockMinuteOf(p.year, p.month, 1, 0, 0)!;
  }
  const len = FIXED_MINUTES[tf];
  return Math.floor(m / len) * len;
}

/** End (exclusive) of the bucket starting at `start`. */
export function bucketEnd(start: WallClockMinute, tf: ReplayTimeframe): WallClockMinute {
  if (tf === "W1") return start + 7 * MINUTES_PER_DAY;
  if (tf === "MN1") {
    const p = partsOf(start);
    return p.month === 12 ? wallClockMinuteOf(p.year + 1, 1, 1, 0, 0)! : wallClockMinuteOf(p.year, p.month + 1, 1, 0, 0)!;
  }
  return start + FIXED_MINUTES[tf];
}

/** Start of the bucket `n` buckets before the one starting at `start`. */
export function bucketStartBefore(start: WallClockMinute, tf: ReplayTimeframe, n: number): WallClockMinute {
  if (tf === "MN1") {
    const p = partsOf(start);
    const index = p.year * 12 + (p.month - 1) - n;
    return wallClockMinuteOf(Math.floor(index / 12), (index % 12) + 1, 1, 0, 0) ?? 0;
  }
  return start - n * nominalMinutes(tf);
}
