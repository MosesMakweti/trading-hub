/**
 * Stage 21.1 §16 — the fix for the chart-side bug found during this stage's
 * audit: the chart previously called `series.setData(...)` (a full
 * candlestick-series replacement) AND forcibly reset the viewport on EVERY
 * Replay Clock tick, since its update effect keyed on `[candles, currentTime]`
 * and `currentTime` changes on every tick. `view.closed`
 * (`visible-candles.ts`'s `buildHigherTimeframeView`) is also a freshly
 * allocated array on every render, so reference equality could never have
 * short-circuited this even by accident.
 *
 * This module is the pure decision logic for what actually changed between
 * two closed-candle arrays, so the chart component can apply the cheapest
 * correct lightweight-charts operation instead of always doing a full
 * `setData` + viewport reset:
 *
 * - NONE: nothing rendered needs to change at all (the common case for
 *   most ticks on a higher display timeframe, where many base-timeframe
 *   ticks pass before the next display candle closes).
 * - APPEND: exactly one new candle was added at the end, and every prior
 *   candle is byte-for-byte unchanged — safe for `series.update(bar)`,
 *   which is a cheap incremental op that does NOT reset the viewport/zoom.
 * - REPLACE: anything else (asset switch, timeframe switch, first load, a
 *   background-fetched chunk retroactively filled in earlier candles,
 *   etc.) — only this case needs a full `series.setData(...)`.
 */
import type { Candle } from "@/domain/market-data/candle";

export type ChartUpdatePlan = { type: "none" } | { type: "append"; bar: Candle } | { type: "replace" };

function candlesEqual(a: Candle, b: Candle): boolean {
  return a.timestamp === b.timestamp && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
}

export function planCandleUpdate(previous: Candle[], next: Candle[]): ChartUpdatePlan {
  if (previous.length === next.length) {
    if (previous.length === 0) return { type: "none" };
    // Every closed candle before the last one is immutable once it closes
    // (§ visible-candles.ts) — comparing only the first and last is a cheap,
    // sufficient proxy for "the whole array is identical" in this domain,
    // since the only way this array's CONTENT changes between two renders
    // of the SAME length is a background fetch retroactively replacing
    // candles (which always changes the last one too, in practice, because
    // `buildHigherTimeframeView` recomputes aggregation from scratch).
    const sameFirst = previous[0].timestamp === next[0].timestamp;
    const sameLast = candlesEqual(previous[previous.length - 1], next[next.length - 1]);
    return sameFirst && sameLast ? { type: "none" } : { type: "replace" };
  }

  if (next.length === previous.length + 1 && previous.length > 0) {
    const sameFirst = previous[0].timestamp === next[0].timestamp;
    const priorUnchanged = candlesEqual(previous[previous.length - 1], next[next.length - 2]);
    if (sameFirst && priorUnchanged) return { type: "append", bar: next[next.length - 1] };
  }

  return { type: "replace" };
}
