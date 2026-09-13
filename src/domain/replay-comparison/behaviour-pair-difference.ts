/**
 * Per-pair Behaviour Difference (Stage 15.2 §14) — conservative by design.
 * Replay has no mood tags or behaviour labels; only process/discipline
 * evidence BOTH sides genuinely capture is compared directly. Everything
 * else frozen on the Actual side (behaviour labels, mood, intent) is
 * surfaced as ACTUAL-ONLY CONTEXT — explanatory evidence, never translated
 * into a fabricated Replay equivalent.
 */
import type { BehaviourPairDifference } from "@/domain/replay-comparison/types";
import type { ActualTradeComparisonSnapshot, ReplayTradeDTO } from "@/types/replay";

const EPSILON = 1e-9;

export function buildBehaviourPairDifference(
  actualSnapshot: ActualTradeComparisonSnapshot | null,
  replay: ReplayTradeDTO,
): BehaviourPairDifference {
  const actualOverridden = (actualSnapshot?.validationState ?? null) === "OVERRIDDEN";
  const replayOverridden = replay.validationState === "OVERRIDDEN";
  const actualTookReplaySkipped = replay.decisionType === "SKIPPED";

  const actualStopMovedOrWidened =
    actualSnapshot?.actualStopLoss != null && actualSnapshot.plannedStopLoss != null
      ? Math.abs(actualSnapshot.actualStopLoss - actualSnapshot.plannedStopLoss) > EPSILON
      : null;

  const replayStopMoved =
    replay.currentStopLoss != null && replay.plannedStopLoss != null && Math.abs(replay.currentStopLoss - replay.plannedStopLoss) > EPSILON;

  // Not determinable from what's frozen on the Actual side (no reliable
  // planned-target-vs-actual-exit signal survives to this comparison) —
  // left null rather than guessed, per this module's conservative mandate.
  const actualManualOrEarlyExit: boolean | null = null;

  const replayFollowedPlannedTargets = replay.decisionType === "TAKEN" && replay.closeReason === "TARGET";

  return {
    actualOverridden,
    replayOverridden,
    actualTookReplaySkipped,
    actualStopMovedOrWidened,
    replayStopMoved,
    actualManualOrEarlyExit,
    replayFollowedPlannedTargets,
    actualBehaviourLabels: actualSnapshot?.behaviourLabels ?? [],
    actualMoodTags: actualSnapshot?.preTradeMoodTags ?? [],
    actualMoodIntensity: actualSnapshot?.preTradeMoodIntensity ?? null,
    actualTradeIntent: actualSnapshot?.tradeIntent ?? null,
  };
}
