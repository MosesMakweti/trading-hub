/**
 * Stage 21.1 §9 — per-instrument chart price-axis precision, reusing the
 * EXISTING instrument catalog (`domain/trade-plan/instrument-catalog.ts`,
 * already used for Trade Plan screenshot recognition) rather than inventing
 * a second metadata source or hardcoding one decimal precision for every
 * instrument. XAUUSD (2 decimals) and EURUSD (5 decimals) must never share
 * a price-axis format.
 */
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";

export interface ChartPriceFormat {
  precision: number;
  minMove: number;
}

/** A conservative default for a symbol the catalog doesn't recognize —
 *  never thrown, since the chart must still render something sensible. */
const DEFAULT_PRICE_FORMAT: ChartPriceFormat = { precision: 2, minMove: 0.01 };

export function resolveChartPriceFormat(canonicalSymbol: string): ChartPriceFormat {
  const spec = lookupInstrument(canonicalSymbol);
  if (!spec) return DEFAULT_PRICE_FORMAT;
  // A futures tick size (e.g. MES's 0.25) is the authoritative minimum price
  // increment; forex/metals have no tick size in the catalog (null), so the
  // decimal precision itself implies the minimum move (e.g. 5dp -> 0.00001).
  // `1 / 10**precision`, never `10**-precision` — the negative-exponent form
  // is exact for positive exponents but introduces binary floating-point
  // error for negative ones (e.g. `Math.pow(10, -5) !== 0.00001` in IEEE 754).
  const minMove = spec.tickSize != null ? Number(spec.tickSize) : 1 / Math.pow(10, spec.decimalPrecision);
  return { precision: spec.decimalPrecision, minMove };
}
