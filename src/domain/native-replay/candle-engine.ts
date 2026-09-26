/**
 * Native Replay — the timeframe aggregation engine (pure, deterministic).
 *
 * Builds any supported timeframe from canonical M1 bars, **as of a replay
 * cutoff**. The cutoff is the open time of the latest revealed M1 bar: bars
 * with `minute <= cutoff` exist, later bars do not. There is no other notion
 * of "now" — every timeframe requested at the same cutoff sees exactly the
 * same market information.
 *
 * For each bucket, over the M1 bars in it that are at or before the cutoff:
 *   open       = first bar's open
 *   high       = max high
 *   low        = min low
 *   close      = last bar's close
 *   tickVolume = sum            (null when the dataset has none)
 *   realVolume = sum            (null when the dataset has none)
 *   spread     = min            (MT5 bars carry the bar's minimal spread in
 *                                points; a spread is never summed)
 *
 * State: a bucket is COMPLETED once the cutoff has reached its last minute
 * (even if that minute had no bar — no ticks), otherwise FORMING. At most the
 * final bucket is FORMING.
 *
 * M1 is atomic: the engine knows each minute's OHLC, never the path inside
 * it. It never interpolates or emits sub-minute points; a forming candle
 * changes only when a whole M1 bar is revealed.
 */
import type { CanonicalM1Bars } from "./m1-dataset";
import { bucketEnd, bucketStart, type ReplayTimeframe } from "./timeframes";
import type { WallClockMinute } from "./wall-clock";

export type CandleState = "COMPLETED" | "FORMING";

/** A candle with exact integer prices (× 10^priceScale). */
export interface EngineCandle {
  time: WallClockMinute; // bucket start
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
  /** M1 bars that contributed (≤ the bucket's minutes; fewer across gaps). */
  barCount: number;
  lastBarTime: WallClockMinute;
  state: CandleState;
}

export interface AggregateOptions {
  timeframe: ReplayTimeframe;
  /** Required — the single replay position. Bars after it are ignored. */
  cutoff: WallClockMinute;
  /** Only buckets starting at or after this minute (inclusive). */
  fromBucket?: WallClockMinute;
}

/**
 * Aggregates `bars` (ascending, unique) into candles. Bars after `cutoff` are
 * skipped here even if a caller passed them (the service also never fetches
 * them) — the engine is the lookahead boundary of last resort.
 */
export function aggregateCandles(bars: CanonicalM1Bars, options: AggregateOptions): EngineCandle[] {
  const { timeframe, cutoff } = options;
  const out: EngineCandle[] = [];
  let current: EngineCandle | null = null;
  let currentEnd = 0;

  for (let i = 0; i < bars.count; i += 1) {
    const m = bars.minute[i];
    if (m > cutoff) break; // ascending — nothing after this is revealed
    const start = bucketStart(m, timeframe);
    if (options.fromBucket != null && start < options.fromBucket) continue;

    if (current == null || start !== current.time) {
      if (current) out.push(current);
      currentEnd = bucketEnd(start, timeframe);
      current = {
        time: start,
        open: bars.open[i],
        high: bars.high[i],
        low: bars.low[i],
        close: bars.close[i],
        tickVolume: bars.tickVolume ? bars.tickVolume[i] : null,
        realVolume: bars.realVolume ? bars.realVolume[i] : null,
        spread: bars.spread ? bars.spread[i] : null,
        barCount: 1,
        lastBarTime: m,
        state: cutoff >= currentEnd - 1 ? "COMPLETED" : "FORMING",
      };
      continue;
    }

    if (bars.high[i] > current.high) current.high = bars.high[i];
    if (bars.low[i] < current.low) current.low = bars.low[i];
    current.close = bars.close[i];
    if (current.tickVolume != null) current.tickVolume += bars.tickVolume![i];
    if (current.realVolume != null) current.realVolume += bars.realVolume![i];
    if (current.spread != null && bars.spread![i] < current.spread) current.spread = bars.spread![i];
    current.barCount += 1;
    current.lastBarTime = m;
  }
  if (current) out.push(current);
  return out;
}

/** Index of the first bar with minute >= `m` (binary search). */
export function lowerBound(minute: Int32Array, count: number, m: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (minute[mid] < m) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
