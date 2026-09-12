/**
 * Trade Review overhaul (Stage 7) — realized R for a trade that may not be
 * fully closed yet. Deliberately separate from domain/performance/realized-r.ts's
 * `computeRealizedR` (which intentionally REFUSES to produce a number until
 * exposure is 100% accounted for — "never settle the Performance Account
 * while exposure remains") — this is a display-only progress read for Trade
 * Review, not a second settlement/PnL system. Reuses the exact same
 * direction-aware distance/ratio primitives (computeInitialRiskDistance,
 * computePlannedR) — no parallel R formula.
 */
import { Decimal } from "decimal.js";
import { computePlannedR, type DirectionLike } from "@/domain/prop-firms/risk";
import { computeInitialRiskDistance, type ExitInput } from "@/domain/performance/realized-r";

export interface RealizedRProgressResult {
  /** Weighted R over whatever proportion IS closed so far. Null when there's
   *  no valid risk distance or no exits yet — never a misleading 0. */
  realizedRSoFar: Decimal | null;
  /** 0–100 — the sum of every exit's proportion, clamped to what's meaningful. */
  proportionClosed: Decimal;
  /** 100 − proportionClosed, floored at 0. */
  remainingProportion: Decimal;
  /** True once ~100% of the position has a recorded exit. */
  isFullyClosed: boolean;
}

/**
 * Realized R so far, weighted by each exit's proportion of the position —
 * same formula as computeRealizedR (Σ exitR × proportion ÷ 100), but reported
 * for WHATEVER has closed rather than requiring the full position to be
 * accounted for. A partially-closed trade can have a real, meaningful
 * realizedRSoFar while remainingProportion stays open (Stage 7 §3/§12).
 */
export function computeRealizedRProgress(
  direction: DirectionLike,
  entry: Decimal.Value,
  initialStop: Decimal.Value,
  exits: ExitInput[],
): RealizedRProgressResult {
  const riskDistance = computeInitialRiskDistance(direction, entry, initialStop);
  if (!riskDistance.greaterThan(0) || exits.length === 0) {
    return {
      realizedRSoFar: null,
      proportionClosed: new Decimal(0),
      remainingProportion: new Decimal(100),
      isFullyClosed: false,
    };
  }

  const entryDec = new Decimal(entry);
  const stopDec = new Decimal(initialStop);
  let weighted = new Decimal(0);
  let totalProportion = new Decimal(0);
  for (const exit of exits) {
    const exitR = computePlannedR(direction, entryDec, stopDec, new Decimal(exit.price)).plannedR ?? new Decimal(0);
    const proportion = new Decimal(exit.proportion);
    totalProportion = totalProportion.plus(proportion);
    weighted = weighted.plus(exitR.times(proportion).dividedBy(100));
  }

  const remaining = Decimal.max(0, new Decimal(100).minus(totalProportion));
  return {
    realizedRSoFar: weighted,
    proportionClosed: totalProportion,
    remainingProportion: remaining,
    isFullyClosed: totalProportion.greaterThanOrEqualTo(99.99),
  };
}
