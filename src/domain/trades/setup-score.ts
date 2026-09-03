// Weighted confluence "setup score" — a thin, backward-compatible wrapper over
// the single direction-aware engine in domain/trades/confluence-score.ts. It
// keeps the historical `SetupScore` shape (setupValid / setupScore / setupRating
// / missingConfluences / missingMandatory) that the trade row, snapshots, and
// analytics already persist and read.
//
// This is a discipline / setup-quality measure, NOT a market-direction
// prediction. Mandatory confluences GATE validity; optional confluences only add
// to the weighted score. There is exactly one scoring engine.

import {
  scoreConfluences,
  type ConfluenceDirectionValue,
  type SetupRating,
  type TradeDirectionValue,
} from "./confluence-score";

export type { SetupRating } from "./confluence-score";
export { ratingForScore } from "./confluence-score";

export interface SetupConfluence {
  name: string;
  weight: number | null; // 0–100; null counts as 0 toward the weighted score
  mandatory: boolean;
  /** Optional — where available, enables direction filtering. Absent = BOTH. */
  id?: string;
  directionApplicability?: ConfluenceDirectionValue | null;
}

export interface SetupScore {
  setupValid: boolean; // false when an ELIGIBLE mandatory confluence is missing
  totalWeight: number; // sum of ELIGIBLE expected confluence weights
  completedWeight: number; // sum of weights of ELIGIBLE confluences present
  setupScore: number | null; // completedWeight / totalWeight × 100 (rounded); null if totalWeight is 0
  setupRating: SetupRating | null; // band of setupScore; null when score is null
  missingConfluences: string[]; // ELIGIBLE expected confluences not present (original names)
  missingMandatory: string[]; // the subset of missing confluences that are mandatory
  /** Selections no longer eligible for the current direction (empty in the
   *  legacy no-direction call). */
  ineligibleSelected: string[];
}

/**
 * Score a setup.
 *
 * @param opts.direction  LONG / SHORT filters confluences to `<dir> + BOTH`
 *   before scoring. Omit entirely to keep the pre-direction behaviour (every
 *   confluence eligible). Pass `null` to represent "no direction chosen yet"
 *   (nothing eligible, score unavailable).
 */
export function scoreSetup(
  expected: SetupConfluence[],
  selectedNames: string[],
  opts?: { direction?: TradeDirectionValue | null },
): SetupScore {
  const directionAware = opts != null && "direction" in opts;

  const result = scoreConfluences({
    confluences: expected.map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory,
      // No direction filtering requested → treat every confluence as neutral.
      directionApplicability: directionAware ? c.directionApplicability ?? "BOTH" : "BOTH",
    })),
    selectedNames,
    direction: directionAware ? (opts!.direction ?? null) : "LONG",
  });

  return {
    // Non-direction-aware call: `direction` was forced to "LONG" above, so
    // `mandatoryRequirementsMet` already means "no eligible mandatory missing".
    setupValid: result.mandatoryRequirementsMet,
    totalWeight: result.totalEligibleWeight,
    completedWeight: result.selectedEligibleWeight,
    setupScore: result.score,
    setupRating: result.rating,
    missingConfluences: result.missingConfluenceNames,
    missingMandatory: result.missingMandatoryConfluenceNames,
    ineligibleSelected: result.ineligibleSelectedConfluenceNames,
  };
}

// Re-export for callers that want the raw engine.
export { scoreConfluences } from "./confluence-score";
export type { ConfluenceScoreResult } from "./confluence-score";
