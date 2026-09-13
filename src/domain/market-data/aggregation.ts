/**
 * Pure OHLC aggregation (Stage 13 §6) — turns a finer-timeframe candle series
 * into a coarser one. Bucket boundaries are UTC-epoch-aligned to the target
 * timeframe's own duration (e.g. every 1h bucket starts exactly on the hour,
 * every 1D bucket at 00:00 UTC) — never a local-calendar boundary, so
 * aggregation can never silently depend on the server's timezone (§22).
 */
import type { Candle } from "@/domain/market-data/candle";
import { compareCandles } from "@/domain/market-data/candle";
import { timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";

/** The start-of-bucket timestamp `timestamp` belongs to, for `tf`. */
export function bucketStart(timestamp: number, tf: Timeframe): number {
  const ms = timeframeToMs(tf);
  return Math.floor(timestamp / ms) * ms;
}

function aggregateGroup(bucketStartTs: number, group: Candle[]): Candle {
  const sorted = [...group].sort(compareCandles);
  const high = Math.max(...sorted.map((c) => c.high));
  const low = Math.min(...sorted.map((c) => c.low));
  // Only claim a total when EVERY candle in the bucket reports volume — a
  // partial sum over a mix of known/unknown values would understate the
  // true total while looking exact, which is worse than admitting "unknown".
  const everyHasVolume = sorted.every((c) => c.volume != null);
  const volume = everyHasVolume ? sorted.reduce((s, c) => s + (c.volume as number), 0) : null;
  return {
    timestamp: bucketStartTs,
    open: sorted[0].open,
    high,
    low,
    close: sorted[sorted.length - 1].close,
    volume,
  };
}

function groupByBucket(candles: Candle[], tf: Timeframe): Map<number, Candle[]> {
  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    const start = bucketStart(c.timestamp, tf);
    (groups.get(start) ?? groups.set(start, []).get(start)!).push(c);
  }
  return groups;
}

/**
 * Aggregates a (not necessarily sorted) finer-timeframe candle array into
 * `targetTimeframe` buckets: open = first (by time) candle's open, high =
 * max high, low = min low, close = last (by time) candle's close, volume =
 * sum when every candle in the bucket has one, else null. Returns buckets in
 * ascending time order. Every bucket present is assumed COMPLETE — callers
 * needing partial/in-progress bucket semantics use `buildHigherTimeframeView`
 * (visible-candles.ts) instead, which is aware of the Replay clock.
 */
export function aggregateCandles(candles: Candle[], targetTimeframe: Timeframe): Candle[] {
  const groups = groupByBucket(candles, targetTimeframe);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, group]) => aggregateGroup(start, group));
}
