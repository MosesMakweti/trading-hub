/**
 * Replay clock foundation (Stage 13 §2) — the ONE candle shape every
 * provider adapter, aggregator, and chart component in Replay uses. UTC
 * epoch milliseconds throughout (never a local-timezone Date getter) so
 * aggregation/bucketing is never accidentally timezone-dependent (§22) —
 * display formatting is the only place that should ever localize a
 * timestamp, same discipline as `dateKeyToUtcDate`/`utcDateToKey` elsewhere
 * in this app.
 */
export interface Candle {
  /** UTC epoch milliseconds — the candle's OPEN time (start of its bucket). */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Not every CFD/forex source publishes volume (§2) — null, never 0, when absent. */
  volume: number | null;
}

/** True when every OHLC field is a finite number in a coherent
 *  high ≥ {open,close,low} ≥ low relationship — a cheap sanity guard for
 *  fixture/provider data before it ever reaches the chart. */
export function isValidCandle(c: Candle): boolean {
  const { open, high, low, close } = c;
  if (![open, high, low, close].every(Number.isFinite)) return false;
  if (high < low) return false;
  if (high < open || high < close) return false;
  if (low > open || low > close) return false;
  return true;
}

/** Ascending-timestamp comparator — every candle array in Replay is kept
 *  sorted this way so binary-search-based lookups (visible-candles.ts) hold. */
export function compareCandles(a: Candle, b: Candle): number {
  return a.timestamp - b.timestamp;
}
