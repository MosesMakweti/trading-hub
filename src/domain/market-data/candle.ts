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

/**
 * Stage 21.2 §7 — the ONE merge rule for combining a client-side candle
 * cache (`baseCandlesByAsset` in replay-market-panel.tsx) with a newly
 * fetched chunk, extracted from what was previously inline (and untested)
 * component logic so chunk-boundary correctness can be proven
 * independently of React. Always re-sorts (never trusts arrival order —
 * background/foreground fetches can resolve out of order) and dedupes by
 * exact timestamp.
 *
 * On a duplicate timestamp, `existing` wins over `incoming` — `existing`
 * is concatenated FIRST and `Array.prototype.sort` is stable (guaranteed
 * since ES2019), so a candle already in the cache is never replaced by a
 * re-fetch of the same minute. This is a deliberate choice (minimize
 * unnecessary churn to an already-rendered candle), not an accident of
 * sort order — see `chart-update-plan.ts` for why identity-stability here
 * matters to the chart's incremental-update decision.
 */
export function mergeCandles(existing: Candle[], incoming: Candle[]): Candle[] {
  const merged = [...existing, ...incoming].sort(compareCandles);
  const deduped: Candle[] = [];
  for (const c of merged) {
    if (deduped.length > 0 && deduped[deduped.length - 1].timestamp === c.timestamp) continue;
    deduped.push(c);
  }
  return deduped;
}
