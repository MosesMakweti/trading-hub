/**
 * Native Replay — client-side incremental candle model for the replay chart.
 *
 * On every replay step the server returns the viewed asset's newly revealed M1
 * bars. Instead of re-reading history (H4 × 500 ≈ 0.5s), the chart folds them
 * into its displayed candles with the SAME pure functions the server's engine
 * uses (`openCandle`, `extendCandle`, `candleState`) — no second copy of the
 * candle math. The result equals the server's aggregation at the same cutoff
 * (tested), and the chart still reconciles with the server at lifecycle
 * points (pause, timeframe/asset switch, page restore): server wins.
 *
 * Prices here are exact integers (× 10^priceScale), rebuilt from the DTO's
 * decimal numbers by rounding — exact for ≤ 8 decimals.
 */
import { candleState, extendCandle, openCandle, type CandleState, type EngineCandle } from "./candle-engine";
import type { CanonicalM1Bars } from "./m1-dataset";
import { bucketStart, type ReplayTimeframe } from "./timeframes";
import type { WallClockMinute } from "./wall-clock";

/** The shape the server sends (prices as decimals). */
export interface CandleWire {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
  barCount: number;
  state: CandleState;
}

const toInt = (price: number, scale: number) => Math.round(price * 10 ** scale);

export function fromWire(c: CandleWire, scale: number): EngineCandle {
  return {
    time: c.minute,
    open: toInt(c.open, scale),
    high: toInt(c.high, scale),
    low: toInt(c.low, scale),
    close: toInt(c.close, scale),
    tickVolume: c.tickVolume,
    realVolume: c.realVolume,
    spread: c.spread,
    barCount: c.barCount,
    lastBarTime: c.minute,
    state: c.state,
  };
}

/** Revealed M1 wire bars (ascending) → canonical integer bars. */
export function wireToBars(m1: CandleWire[], scale: number): CanonicalM1Bars {
  const n = m1.length;
  const bars: CanonicalM1Bars = {
    count: n,
    minute: new Int32Array(n),
    open: new Int32Array(n),
    high: new Int32Array(n),
    low: new Int32Array(n),
    close: new Int32Array(n),
    tickVolume: n && m1[0].tickVolume != null ? new Int32Array(n) : null,
    realVolume: n && m1[0].realVolume != null ? new Float64Array(n) : null,
    spread: n && m1[0].spread != null ? new Int32Array(n) : null,
  };
  m1.forEach((b, i) => {
    bars.minute[i] = b.minute;
    bars.open[i] = toInt(b.open, scale);
    bars.high[i] = toInt(b.high, scale);
    bars.low[i] = toInt(b.low, scale);
    bars.close[i] = toInt(b.close, scale);
    if (bars.tickVolume) bars.tickVolume[i] = b.tickVolume ?? 0;
    if (bars.realVolume) bars.realVolume[i] = b.realVolume ?? 0;
    if (bars.spread) bars.spread[i] = b.spread ?? 0;
  });
  return bars;
}

export interface ApplyResult {
  /** Candles to hand to the chart's incremental update, oldest first (updated last candle and/or new ones). */
  changed: EngineCandle[];
}

/**
 * Folds newly revealed M1 bars into `candles` (mutated; ascending) and moves
 * the cutoff to `cutoff` (the new world time — possibly later than the last
 * bar, when another asset traded and this one didn't).
 */
export function applyRevealed(candles: EngineCandle[], revealed: CanonicalM1Bars, timeframe: ReplayTimeframe, cutoff: WallClockMinute): ApplyResult {
  const changed = new Set<EngineCandle>();
  const previousLast = candles[candles.length - 1];
  for (let i = 0; i < revealed.count; i += 1) {
    const last = candles[candles.length - 1];
    if (last && revealed.minute[i] <= last.lastBarTime) continue; // already folded (e.g. a retried step)
    const start = bucketStart(revealed.minute[i], timeframe);
    if (last && last.time === start) {
      extendCandle(last, revealed, i);
      changed.add(last);
    } else {
      const next = openCandle(revealed, i, timeframe, cutoff);
      candles.push(next);
      changed.add(next);
    }
  }
  // The clock moved. Only the candle that was last before this step and the
  // candles this step touched can change state (everything older was already
  // complete — only the final candle is ever forming): re-evaluate exactly
  // those. The previous last may complete even without a new bar of its own.
  for (const c of [previousLast, ...changed]) {
    if (!c) continue;
    const state = candleState(c.time, timeframe, cutoff);
    if (state !== c.state) {
      c.state = state;
      changed.add(c);
    }
  }
  return { changed: [...changed].sort((a, b) => a.time - b.time) };
}

/** Candles that differ between the client model and the server (for reconciliation). */
export function diffCandles(client: EngineCandle[], server: EngineCandle[]): number {
  const byTime = new Map(client.map((c) => [c.time, c]));
  let mismatches = Math.abs(client.length - server.length);
  for (const s of server) {
    const c = byTime.get(s.time);
    if (!c || c.open !== s.open || c.high !== s.high || c.low !== s.low || c.close !== s.close || c.state !== s.state || c.barCount !== s.barCount) mismatches += 1;
  }
  return mismatches;
}
