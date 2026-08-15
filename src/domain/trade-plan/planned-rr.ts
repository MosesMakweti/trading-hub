/**
 * Planned R:R math for the TradingView Screenshot Trade Plan (spec §10/§11).
 * Reuses domain/prop-firms/risk.ts's `computePlannedR` for the actual
 * direction-aware risk/reward-distance formula — that function already does
 * exactly this calculation (used there per-account-execution); this module
 * only adds what's new here: per-target R across a whole target list, the
 * weighted-planned-R rollup, and the detected-vs-calculated R:R mismatch
 * check. No duplicate distance/R formula.
 */
import { Decimal } from "decimal.js";
import { computePlannedR, type DirectionLike } from "@/domain/prop-firms/risk";

export interface PlannedTargetInput {
  targetOrder: number;
  targetPrice: Decimal.Value;
  plannedClosePercent: Decimal.Value | null;
}

export interface PlannedTargetRResult {
  targetOrder: number;
  rMultiple: Decimal | null;
  reason?: string;
}

/** R-multiple for every target against the same entry/stop — one
 *  computePlannedR call per target, never re-deriving the risk-distance formula. */
export function computeTargetRMultiples(
  direction: DirectionLike,
  entry: Decimal.Value | null,
  stopLoss: Decimal.Value | null,
  targets: PlannedTargetInput[],
): PlannedTargetRResult[] {
  const entryDecimal = entry == null ? null : new Decimal(entry);
  const stopDecimal = stopLoss == null ? null : new Decimal(stopLoss);
  return targets.map((t) => {
    const result = computePlannedR(direction, entryDecimal, stopDecimal, new Decimal(t.targetPrice));
    return { targetOrder: t.targetOrder, rMultiple: result.plannedR, reason: result.reason };
  });
}

export interface WeightedPlannedRResult {
  weightedR: Decimal | null;
  /** Sum of every target's plannedClosePercent — null entries count as 0. */
  totalAllocatedPercent: Decimal;
  /** 100 − totalAllocatedPercent, floored at 0 — the runner left unaccounted for. */
  remainingRunnerPercent: Decimal;
  /** True when any target is missing an R-multiple (unresolved plan) or a close percent — weightedR is still computed from what's available, but callers should show this as incomplete. */
  incomplete: boolean;
}

/** Weighted Planned R = Σ (target R × planned close % ÷ 100) — spec §11.
 *  A target with no plannedClosePercent contributes 0 to the weighted sum
 *  (its R is real but nothing is planned to close there yet) and marks the
 *  result incomplete, distinguishing "no plan yet" from "0% planned on purpose". */
export function computeWeightedPlannedR(targetRs: PlannedTargetRResult[], targets: PlannedTargetInput[]): WeightedPlannedRResult {
  let weighted = new Decimal(0);
  let totalPercent = new Decimal(0);
  let incomplete = false;
  let anyResolved = false;

  const percentByOrder = new Map(targets.map((t) => [t.targetOrder, t.plannedClosePercent]));

  for (const { targetOrder, rMultiple } of targetRs) {
    const percent = percentByOrder.get(targetOrder);
    if (rMultiple == null) {
      incomplete = true;
      continue;
    }
    anyResolved = true;
    if (percent == null) {
      incomplete = true;
      continue;
    }
    const percentDecimal = new Decimal(percent);
    totalPercent = totalPercent.plus(percentDecimal);
    weighted = weighted.plus(rMultiple.times(percentDecimal).dividedBy(100));
  }

  return {
    weightedR: anyResolved ? weighted : null,
    totalAllocatedPercent: totalPercent,
    remainingRunnerPercent: Decimal.max(0, new Decimal(100).minus(totalPercent)),
    incomplete,
  };
}

export interface RRMismatchCheck {
  mismatched: boolean;
  detected: Decimal | null;
  calculated: Decimal | null;
  message?: string;
}

/** Compares a TradingView-visible R:R (if the screenshot showed one) against
 *  the value derived from confirmed prices (spec §10). The price-derived
 *  value always wins as the analytical value; this only decides whether to
 *  show the trader a review warning. Tolerance is relative (5%) since a
 *  detected R:R is usually rounded (e.g. "2R" vs a computed 1.97R). */
export function checkRRMismatch(detectedRR: Decimal.Value | null, calculatedRR: Decimal | null, tolerancePercent: Decimal.Value = 5): RRMismatchCheck {
  if (detectedRR == null || calculatedRR == null) {
    return { mismatched: false, detected: detectedRR == null ? null : new Decimal(detectedRR), calculated: calculatedRR };
  }
  const detected = new Decimal(detectedRR);
  const diff = detected.minus(calculatedRR).abs();
  const tolerance = calculatedRR.abs().times(new Decimal(tolerancePercent).dividedBy(100));
  const mismatched = diff.greaterThan(tolerance);
  return {
    mismatched,
    detected,
    calculated: calculatedRR,
    message: mismatched ? "Detected R:R does not match the confirmed price levels. Review the screenshot values." : undefined,
  };
}
