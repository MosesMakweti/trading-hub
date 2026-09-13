/**
 * THE no-hindsight rule (Stage 13 §11-12/§17) — the ONE place that decides
 * what market data a Replay session may see at a given historical moment.
 * No chart, indicator, or decision-logic component may independently decide
 * what "future" means; every one of them must go through `visibleCandles`
 * (or `buildHigherTimeframeView`, which is built on top of it).
 *
 * CANDLE REVEAL SEMANTICS (§12, documented decision): `replayTime` is a
 * "closed-candle" clock — a candle at `timestamp` with duration `tf` becomes
 * visible only once it has FULLY CLOSED, i.e. `timestamp + duration(tf) <=
 * replayTime`. A candle whose close time exactly equals `replayTime` IS
 * visible (its last tick already happened); a candle still open AT
 * `replayTime` is not. Concretely: at replayTime 10:15 on a 5m base
 * timeframe, the 10:10-10:15 candle IS visible (it just closed) but the
 * 10:15-10:20 candle is NOT — the trader cannot yet know its outcome. This
 * is deliberately the strict, safe reading; intrabar/tick simulation (seeing
 * partial movement WITHIN the currently-forming base candle) is explicitly
 * deferred (§12) — Stage 13 never fabricates that.
 */
import type { Candle } from "@/domain/market-data/candle";
import { aggregateCandles, bucketStart } from "@/domain/market-data/aggregation";
import { timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";

/**
 * Every candle of `baseTimeframe` that has fully closed at or before
 * `replayTime`. `candles` need not be pre-sorted or pre-filtered — this is
 * the single source of truth other Replay code composes from.
 */
export function visibleCandles(candles: Candle[], replayTime: number, baseTimeframe: Timeframe): Candle[] {
  const durationMs = timeframeToMs(baseTimeframe);
  return candles.filter((c) => c.timestamp + durationMs <= replayTime).sort((a, b) => a.timestamp - b.timestamp);
}

export interface HigherTimeframeView {
  /** Fully closed higher-timeframe candles — safe to render exactly as-is. */
  closed: Candle[];
  /**
   * The CURRENTLY FORMING higher-timeframe candle, built ONLY from base
   * candles already visible at `replayTime` — never the provider's own
   * (future-informed) completed OHLC for that same window. Null once no
   * base data has arrived for the current bucket yet, or when the review
   * period has no open bucket left. Stage 13 ships with this excluded from
   * the chart by default (§17 "safest and simplest" — hide incomplete
   * higher-timeframe candles entirely); it's still computed and exposed
   * here for a future stage that wants to render an updating in-progress
   * bar, since it can never leak information the trader wouldn't already
   * have from the base timeframe.
   */
  partial: Candle | null;
}

/**
 * Higher-timeframe safety (§17) — the fix for the exact scenario the stage
 * calls out: a provider's completed 10:00-11:00 1h candle must never be
 * shown at replayTime 10:30. This function NEVER aggregates the provider's
 * own higher-timeframe candles; it only ever aggregates base-timeframe
 * candles that have already individually passed the closed-candle test
 * above, so a "closed" result here is only ever as informed as the base
 * data the trader could already see.
 */
export function buildHigherTimeframeView(
  baseCandles: Candle[],
  replayTime: number,
  baseTimeframe: Timeframe,
  targetTimeframe: Timeframe,
): HigherTimeframeView {
  if (targetTimeframe === baseTimeframe) {
    return { closed: visibleCandles(baseCandles, replayTime, baseTimeframe), partial: null };
  }

  const visibleBase = visibleCandles(baseCandles, replayTime, baseTimeframe);
  const aggregated = aggregateCandles(visibleBase, targetTimeframe);
  const targetDurationMs = timeframeToMs(targetTimeframe);

  const closed: Candle[] = [];
  let partial: Candle | null = null;
  for (const candle of aggregated) {
    const bucketFullyElapsed = bucketStart(candle.timestamp, targetTimeframe) + targetDurationMs <= replayTime;
    if (bucketFullyElapsed) closed.push(candle);
    else partial = candle;
  }
  return { closed, partial };
}
