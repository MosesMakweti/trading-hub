/**
 * Trade Review overhaul (Stage 7 §5) — structures the existing plan/actual
 * data into one clean comparison. Pure and framework-free: no new math here
 * beyond simple deltas — planned R comes from domain/trade-plan/planned-rr.ts
 * (already frozen on Trade.expectedRR by savePlan) and realized R from
 * domain/trades/realized-r-progress.ts. Not an analytics/discrepancy engine —
 * just a clean read model later stages (and Stage 8's Journal rebuild) can
 * consume without re-deriving this shape.
 */

export interface PlannedVsActualTargetDTO {
  targetOrder: number;
  label: string;
  plannedPrice: number;
  plannedClosePercent: number | null;
  plannedRMultiple: number | null;
}

export interface PlannedVsActualExitDTO {
  exitOrder: number;
  exitPrice: number;
  percentClosed: number | null;
  realizedR: number | null;
  exitedAt: string; // ISO
}

export interface PlannedSideDTO {
  entry: number | null;
  stopLoss: number | null;
  targets: PlannedVsActualTargetDTO[];
  /** The weighted Planned Realized R across all targets (Trade.expectedRR). */
  realizedR: number | null;
}

export interface ActualSideDTO {
  entry: number | null;
  stopLoss: number | null;
  exits: PlannedVsActualExitDTO[];
  finalExit: number | null;
  /** Realized R so far — meaningful even while part of the position is still open. */
  realizedRSoFar: number | null;
  proportionClosedPercent: number;
  remainingProportionPercent: number;
  isFullyClosed: boolean;
}

export interface PlannedVsActualDTO {
  planned: PlannedSideDTO;
  actual: ActualSideDTO;
  differences: {
    entryDelta: number | null;
    stopLossDelta: number | null;
    realizedRDelta: number | null;
  };
}

function delta(planned: number | null, actual: number | null): number | null {
  return planned != null && actual != null ? actual - planned : null;
}

export function buildPlannedVsActual(planned: PlannedSideDTO, actual: ActualSideDTO): PlannedVsActualDTO {
  return {
    planned,
    actual,
    differences: {
      entryDelta: delta(planned.entry, actual.entry),
      stopLossDelta: delta(planned.stopLoss, actual.stopLoss),
      realizedRDelta: delta(planned.realizedR, actual.realizedRSoFar),
    },
  };
}
