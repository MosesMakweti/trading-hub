/**
 * Override/validation-state analysis (Stage 15.2 §21) — a compact count
 * matrix for each side plus the three named "review cases." These are
 * factual co-occurrences, never automatic mistakes (§21).
 */
import type { MatchedDecisionPair, OverrideAnalysis } from "@/domain/replay-comparison/types";
import type { ReplayTradeDTO } from "@/types/replay";
import type { ActualTradeRefDTO } from "@/types/replay";

export function buildOverrideAnalysis(
  actualTrades: ActualTradeRefDTO[],
  replayTrades: ReplayTradeDTO[],
  matched: MatchedDecisionPair[],
): OverrideAnalysis {
  const actual = {
    validated: actualTrades.filter((t) => t.validationState === "VALIDATED").length,
    overridden: actualTrades.filter((t) => t.validationState === "OVERRIDDEN").length,
    notValidated: actualTrades.filter((t) => t.validationState === "NOT_VALIDATED").length,
  };

  const takenReplay = replayTrades.filter((t) => t.decisionType === "TAKEN");
  const replay = {
    validated: takenReplay.filter((t) => t.validationState === "VALIDATED").length,
    overridden: takenReplay.filter((t) => t.validationState === "OVERRIDDEN").length,
    skipped: replayTrades.filter((t) => t.decisionType === "SKIPPED").length,
  };

  let actualOverrideReplaySkipped = 0;
  let actualOverrideReplayValidated = 0;
  let actualValidatedReplaySkipped = 0;
  for (const pair of matched) {
    const actualOverridden = pair.decision.actualValidationState === "OVERRIDDEN";
    const actualValidated = pair.decision.actualValidationState === "VALIDATED";
    const replaySkipped = pair.replay.decisionType === "SKIPPED";
    const replayValidated = pair.replay.validationState === "VALIDATED";
    if (actualOverridden && replaySkipped) actualOverrideReplaySkipped += 1;
    if (actualOverridden && replayValidated) actualOverrideReplayValidated += 1;
    if (actualValidated && replaySkipped) actualValidatedReplaySkipped += 1;
  }

  return { actual, replay, actualOverrideReplaySkipped, actualOverrideReplayValidated, actualValidatedReplaySkipped };
}
