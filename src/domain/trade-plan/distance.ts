/**
 * Decimal-safe planned-distance math (spec §6). TradeOS never forces every
 * instrument into pips — the unit is resolved per instrument (forex → pips,
 * futures → ticks, everything else → points/price/percent) and carried
 * alongside every distance value so analytics can group correctly instead of
 * averaging incompatible units together (spec §17).
 */
import { Decimal } from "decimal.js";
import type { DistanceUnitLike, InstrumentSpec } from "@/domain/trade-plan/instrument-catalog";

export interface DistanceResult {
  distance: Decimal;
  unit: DistanceUnitLike;
}

/** Distance in Units = |priceA − priceB| ÷ instrument unit size (spec §6
 *  formula). Picks the instrument's preferred unit and its matching size
 *  (pip for forex, tick for futures, point for indices/metals/crypto that
 *  define one); falls back to raw PRICE distance when the spec has no sized
 *  unit for its preferred unit (e.g. crypto priced in whole-dollar moves). */
export function computeDistance(priceA: Decimal.Value, priceB: Decimal.Value, spec: InstrumentSpec | null): DistanceResult {
  const raw = new Decimal(priceA).minus(priceB).abs();
  if (!spec) return { distance: raw, unit: "PRICE" };

  const sizeFor = (unit: DistanceUnitLike): string | null => {
    if (unit === "PIP") return spec.pipSize;
    if (unit === "TICK") return spec.tickSize;
    if (unit === "POINT") return spec.pointSize;
    return null;
  };

  const size = sizeFor(spec.preferredUnit);
  if (size == null) return { distance: raw, unit: spec.preferredUnit === "PERCENT" ? "PERCENT" : "PRICE" };
  return { distance: raw.dividedBy(size), unit: spec.preferredUnit };
}

/** Percentage price move — useful for cross-asset comparison (spec §17: "use
 *  normalized R-multiples or percentage movement rather than raw pips"). */
export function computePercentDistance(priceA: Decimal.Value, priceB: Decimal.Value): Decimal {
  const a = new Decimal(priceA);
  const b = new Decimal(priceB);
  if (a.isZero()) return new Decimal(0);
  return b.minus(a).abs().dividedBy(a).times(100);
}
