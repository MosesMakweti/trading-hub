/**
 * Canonical timeframe (Stage 13 §5) — the ONE representation used across
 * Replay: provider adapters, aggregation, the clock, and the chart all speak
 * this type. Never represent 15 minutes as `15`, `"15"`, `"M15"`, or
 * `"FIFTEEN_MINUTES"` anywhere else — a provider adapter translates ITS OWN
 * vocabulary to/from this one at its boundary, never the other way around.
 */
export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Canonical timeframe → duration in minutes — the single source every
 *  aggregation/bucketing computation derives from. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1D": 1440,
};

export function timeframeToMs(tf: Timeframe): number {
  return TIMEFRAME_MINUTES[tf] * 60_000;
}

/** Ascending granularity order — index 0 is the finest timeframe. */
export function timeframeRank(tf: Timeframe): number {
  return TIMEFRAMES.indexOf(tf);
}

export function isFinerThan(a: Timeframe, b: Timeframe): boolean {
  return TIMEFRAME_MINUTES[a] < TIMEFRAME_MINUTES[b];
}

/** Every canonical timeframe strictly coarser than `base` — a provider
 *  whose native series is `base` can derive all of these via aggregation. */
export function derivableTimeframes(base: Timeframe): Timeframe[] {
  return TIMEFRAMES.filter((tf) => TIMEFRAME_MINUTES[tf] > TIMEFRAME_MINUTES[base]);
}
