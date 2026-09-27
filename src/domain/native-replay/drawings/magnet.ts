/**
 * Native Replay — magnet snapping.
 *
 * Snaps an anchor to the nearest open/high/low/close of the candle under the
 * pointer when it is within `thresholdPx` on screen. It only ever sees the
 * candles the caller passes — the chart's REVEALED candles — so it cannot
 * discover a price after the replay position: over empty future space there is
 * no candle and nothing to snap to. It never alters candle data.
 */

export interface SnapCandle {
  time: number; // bucket start (wall-clock minute)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SnapInput {
  /** Pointer position on screen. */
  y: number;
  /** Index of the candle under the pointer (rounded logical index), or null when not over a candle. */
  candleIndex: number | null;
  candles: readonly SnapCandle[];
  priceToY: (price: number) => number | null;
  thresholdPx: number;
}

export function snapPrice(input: SnapInput): { price: number; time: number } | null {
  const { candleIndex, candles } = input;
  if (candleIndex == null || candleIndex < 0 || candleIndex >= candles.length) return null;
  const c = candles[candleIndex];
  let best: { price: number; d: number } | null = null;
  for (const price of [c.open, c.high, c.low, c.close]) {
    const y = input.priceToY(price);
    if (y == null) continue;
    const d = Math.abs(y - input.y);
    if (d <= input.thresholdPx && (!best || d < best.d)) best = { price, d };
  }
  return best ? { price: best.price, time: c.time } : null;
}
