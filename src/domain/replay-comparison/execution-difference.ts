/**
 * Objective Actual-vs-Replay execution comparison (Stage 15.2 §11-13) — now
 * that Stage 15.1 froze real Actual execution evidence. Reuses the existing
 * instrument catalog (`domain/trade-plan/instrument-catalog.ts`) and
 * distance math (`domain/trade-plan/distance.ts`) rather than comparing raw
 * prices only, and reuses the SAME risk-basis convention as every other R
 * calculation in this app: the ORIGINAL entry/stop distance, never a
 * moved/current stop.
 *
 * This is deliberately a DIFFERENT axis from `domain/trade-plan/
 * plan-execution-comparison.ts` (which compares one trade's OWN plan
 * against its OWN actual fill) — here the two "sides" being compared are
 * Actual's real execution and Replay's simulated execution, so this module
 * does its own direction-aware normalization rather than force-fitting the
 * planned-vs-actual engine's BETTER/WORSE labels (which would read as a
 * verdict in this neutral context, per Stage 15.2 §30).
 */
import { computeDistance } from "@/domain/trade-plan/distance";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";
import type { ExecutionDifference, FrozenExitEvent, NormalizedPriceDifference } from "@/domain/replay-comparison/types";
import type { ActualTradeComparisonSnapshot, ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

const EMPTY_PRICE_DIFF: NormalizedPriceDifference = {
  actual: null,
  replay: null,
  signedDifference: null,
  rDistance: null,
  unitDistance: null,
  unit: null,
};

/** `replay - actual` in price terms, plus the same magnitude normalized to
 *  R (using the ACTUAL trade's own risk unit — the real money at stake) and
 *  to the instrument's natural unit (pips/ticks/points) when resolvable. */
function normalizedPriceDifference(
  actualPrice: number | null,
  replayPrice: number | null,
  assetSymbol: string,
  actualRiskDistance: number | null,
): NormalizedPriceDifference {
  if (actualPrice == null || replayPrice == null) return EMPTY_PRICE_DIFF;

  const spec = lookupInstrument(assetSymbol);
  const distance = computeDistance(actualPrice, replayPrice, spec);
  const signedDifference = replayPrice - actualPrice;
  const rDistance = actualRiskDistance != null && actualRiskDistance > 0 ? signedDifference / actualRiskDistance : null;

  return {
    actual: actualPrice,
    replay: replayPrice,
    signedDifference,
    rDistance,
    unitDistance: distance.distance.toNumber(),
    unit: distance.unit,
  };
}

export function buildExecutionDifference(
  actualSnapshot: ActualTradeComparisonSnapshot | null,
  actualRef: ActualTradeRefDTO,
  replay: ReplayTradeDTO,
): ExecutionDifference {
  const actualHadPartials = actualRef.reviewLifecycleStatus === "PARTIALLY_CLOSED";
  const replayHadPartials = replay.partialExits.length > 0;
  const replayRealizedR = replay.decisionType === "TAKEN" ? replay.realizedReplayR : null;

  if (!actualSnapshot) {
    return {
      actualReviewLifecycle: actualRef.reviewLifecycleStatus,
      replayLifecycle: replay.lifecycle,
      actualHadPartials,
      replayHadPartials,
      samePartialManagementShape: actualHadPartials === replayHadPartials,
      comparable: false,
      entry: EMPTY_PRICE_DIFF,
      initialStop: EMPTY_PRICE_DIFF,
      actualPartialExits: [],
      replayPartialExits: [],
      actualFullExit: null,
      replayFullExit: null,
      actualRealizedR: actualRef.realizedR,
      replayRealizedR,
    };
  }

  const actualEntry = actualSnapshot.actualEntry;
  const actualStop = actualSnapshot.resolvedInitialStop ?? actualSnapshot.actualStopLoss ?? actualSnapshot.plannedStopLoss;
  const actualRiskDistance = actualEntry != null && actualStop != null ? Math.abs(actualEntry - actualStop) : null;

  const replayEntry = replay.simulatedEntry ?? replay.plannedEntry;
  // Replay's FROZEN original 1R basis — never `currentStopLoss` (moving the
  // stop must never redefine what 1R means, same rule as the execution
  // engine itself).
  const replayInitialStop = replay.plannedStopLoss;

  const actualPartialExits: FrozenExitEvent[] = actualSnapshot.partialExits.map((p) => ({
    order: p.order,
    price: p.price,
    percentClosed: p.percentClosed,
    timestamp: p.exitedAt,
    realizedR: p.realizedR,
  }));
  const replayPartialExits: FrozenExitEvent[] = replay.partialExits.map((p, i) => ({
    order: i + 1,
    price: p.exitPrice,
    percentClosed: p.percentClosed,
    timestamp: p.executedAt,
    realizedR: p.realizedR,
  }));

  return {
    actualReviewLifecycle: actualRef.reviewLifecycleStatus,
    replayLifecycle: replay.lifecycle,
    actualHadPartials,
    replayHadPartials,
    samePartialManagementShape: actualHadPartials === replayHadPartials,
    comparable: actualEntry != null && replayEntry != null,
    entry: normalizedPriceDifference(actualEntry, replayEntry, actualSnapshot.assetSymbol, actualRiskDistance),
    initialStop: normalizedPriceDifference(actualStop, replayInitialStop, actualSnapshot.assetSymbol, actualRiskDistance),
    actualPartialExits,
    replayPartialExits,
    actualFullExit: actualSnapshot.actualExit,
    replayFullExit: replay.simulatedExit,
    actualRealizedR: actualSnapshot.realizedR,
    replayRealizedR,
  };
}
