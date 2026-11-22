/**
 * Simulated market mechanics on M1 bars — pure, integer-point arithmetic.
 *
 * Prices here are the dataset's integer points (price × 10^priceScale), the
 * same representation HistoricalBar stores, so trigger and fill decisions are
 * exact. Money is computed elsewhere (fills.ts) with Decimal.
 *
 * Bid/ask (decision D7): MT5 bar exports are BID prices. The ask is
 * bid + spread, where spread is the bar's own spread (points) or the
 * account's default when the bar has none. Buys fill at the ask, sells at the
 * bid; a long position closes at the bid, a short at the ask.
 *
 * Intrabar order is unknown from OHLC. Two conservative rules (D5):
 *  - if one bar reaches both the stop and the target, the STOP fills and the
 *    exit is flagged `ambiguous`;
 *  - on the bar a pending order fills, only the stop is checked afterwards —
 *    a target is never assumed to have been reached after the fill.
 * Gaps: when a bar OPENS beyond a level, the fill is at the open (slippage
 * for stops, price improvement for limits and targets).
 */

export type SimSide = "BUY" | "SELL";
export type SimPendingType = "LIMIT" | "STOP";

/** One M1 bar in integer points (bid), with its spread in points (0 = none recorded). */
export interface SimBar {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number;
}

export function effectiveSpread(bar: Pick<SimBar, "spread">, defaultSpreadPoints: number): number {
  return bar.spread > 0 ? bar.spread : defaultSpreadPoints;
}

/** Price at which a market order on `side` fills on this bar's close. */
export function marketFillPrice(side: SimSide, bar: SimBar, spread: number): number {
  return side === "BUY" ? bar.close + spread : bar.close;
}

/** Price at which an open position on `side` would close right now (bar close). */
export function markPrice(side: SimSide, bar: SimBar, spread: number): number {
  return side === "BUY" ? bar.close : bar.close + spread;
}

/** The worst price an open position saw during this bar — used for equity-based rules (D6). */
export function adversePrice(side: SimSide, bar: SimBar, spread: number): number {
  return side === "BUY" ? bar.low : bar.high + spread;
}

export interface PendingFill {
  price: number;
  /** The bar opened through the level; filled at the open. */
  gapped: boolean;
}

/**
 * Does a pending order trigger on this bar, and at what price?
 *  BUY LIMIT  — ask falls to the price or below      BUY STOP  — ask rises to the price or above
 *  SELL LIMIT — bid rises to the price or above      SELL STOP — bid falls to the price or below
 */
export function pendingFill(order: { side: SimSide; type: SimPendingType; price: number }, bar: SimBar, spread: number): PendingFill | null {
  const ask = { open: bar.open + spread, high: bar.high + spread, low: bar.low + spread };
  const p = order.price;
  if (order.side === "BUY" && order.type === "LIMIT") {
    if (ask.open <= p) return { price: ask.open, gapped: true };
    return ask.low <= p ? { price: p, gapped: false } : null;
  }
  if (order.side === "BUY" && order.type === "STOP") {
    if (ask.open >= p) return { price: ask.open, gapped: true };
    return ask.high >= p ? { price: p, gapped: false } : null;
  }
  if (order.side === "SELL" && order.type === "LIMIT") {
    if (bar.open >= p) return { price: bar.open, gapped: true };
    return bar.high >= p ? { price: p, gapped: false } : null;
  }
  if (bar.open <= p) return { price: bar.open, gapped: true };
  return bar.low <= p ? { price: p, gapped: false } : null;
}

export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT";

export interface ExitFill {
  reason: ExitReason;
  price: number;
  gapped: boolean;
  /** The bar reached both levels; the stop was assumed first (D5). */
  ambiguous: boolean;
}

/**
 * Does an open position's stop or target fill on this bar?
 * `stopOnly` is set for the bar on which the position was opened by a
 * pending order (the target can't be assumed to come after the fill).
 */
export function exitOnBar(
  position: { side: SimSide; stopLoss: number | null; takeProfit: number | null },
  bar: SimBar,
  spread: number,
  stopOnly = false,
): ExitFill | null {
  const long = position.side === "BUY";
  // A long closes at the bid; a short closes at the ask.
  const c = long
    ? { open: bar.open, high: bar.high, low: bar.low }
    : { open: bar.open + spread, high: bar.high + spread, low: bar.low + spread };
  const sl = position.stopLoss;
  const tp = stopOnly ? null : position.takeProfit;

  if (sl != null && (long ? c.open <= sl : c.open >= sl)) return { reason: "STOP_LOSS", price: c.open, gapped: true, ambiguous: false };
  if (tp != null && (long ? c.open >= tp : c.open <= tp)) return { reason: "TAKE_PROFIT", price: c.open, gapped: true, ambiguous: false };

  const slHit = sl != null && (long ? c.low <= sl : c.high >= sl);
  const tpHit = tp != null && (long ? c.high >= tp : c.low <= tp);
  if (slHit) return { reason: "STOP_LOSS", price: sl!, gapped: false, ambiguous: tpHit };
  if (tpHit) return { reason: "TAKE_PROFIT", price: tp!, gapped: false, ambiguous: false };
  return null;
}

/** Validates SL/TP placement relative to a reference price for a side. Returns an error message or null. */
export function protectiveLevelError(side: SimSide, reference: number, stopLoss: number | null, takeProfit: number | null): string | null {
  if (stopLoss != null && (side === "BUY" ? stopLoss >= reference : stopLoss <= reference)) {
    return side === "BUY" ? "A buy's stop loss must be below the entry price." : "A sell's stop loss must be above the entry price.";
  }
  if (takeProfit != null && (side === "BUY" ? takeProfit <= reference : takeProfit >= reference)) {
    return side === "BUY" ? "A buy's take profit must be above the entry price." : "A sell's take profit must be below the entry price.";
  }
  return null;
}

/** Validates a pending order's price against the current market. Returns an error message or null. */
export function pendingPriceError(side: SimSide, type: SimPendingType, price: number, bid: number, ask: number): string | null {
  if (side === "BUY" && type === "LIMIT" && price >= ask) return "A buy limit must be below the current ask.";
  if (side === "BUY" && type === "STOP" && price <= ask) return "A buy stop must be above the current ask.";
  if (side === "SELL" && type === "LIMIT" && price <= bid) return "A sell limit must be above the current bid.";
  if (side === "SELL" && type === "STOP" && price >= bid) return "A sell stop must be below the current bid.";
  return null;
}
