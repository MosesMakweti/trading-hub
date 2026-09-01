// The single source of truth for weighted, DIRECTION-AWARE confluence scoring.
//
// Bullish and bearish confluences must never share a denominator: a long trade is
// scored only against BULLISH + BOTH confluences, a short trade only against
// BEARISH + BOTH. Eligibility is filtered BEFORE the weighted score and BEFORE
// the mandatory-requirement check, so an ineligible weight can't drag the score
// down and an ineligible mandatory confluence can't invalidate the setup.
//
// This is a discipline / setup-quality measure, NOT a market-direction
// prediction. `scoreSetup` (domain/trades/setup-score.ts) is a thin wrapper over
// this — there is no second scoring engine.

export type ConfluenceDirectionValue = "BULLISH" | "BEARISH" | "BOTH";
export type TradeDirectionValue = "LONG" | "SHORT";

export type SetupRating = "A+" | "A" | "B" | "C" | "LOW";

/** A+ 95–100 · A 85–94 · B 75–84 · C 65–74 · Low < 65. */
export function ratingForScore(score: number): SetupRating {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  return "LOW";
}

export interface ScorableConfluence {
  /** Stable identity for the result arrays. Falls back to `name` where a real
   *  id isn't available (legacy snapshots). */
  id: string;
  /** Matched (case-insensitively, trimmed) against `selectedNames`. */
  name: string;
  /** 0–100. null / negative / non-finite is clamped to 0. */
  weight: number | null;
  mandatory: boolean;
  /** Absent → treated as BOTH (legacy rows / snapshots). */
  directionApplicability?: ConfluenceDirectionValue | null;
}

export interface ConfluenceScoreInput {
  confluences: ScorableConfluence[];
  selectedNames: string[];
  /** null = the trader hasn't chosen a direction yet → nothing is eligible and
   *  the score is unavailable. */
  direction: TradeDirectionValue | null;
}

export interface ConfluenceScoreResult {
  /** completedEligibleWeight / totalEligibleWeight × 100, rounded. null when
   *  there is no eligible weight to divide by (never divides by zero). */
  score: number | null;
  rating: SetupRating | null;
  selectedEligibleWeight: number;
  totalEligibleWeight: number;
  /** Eligible mandatory confluences are all present. When no direction is set
   *  this is false (nothing can be confirmed yet). */
  mandatoryRequirementsMet: boolean;
  missingMandatoryConfluenceIds: string[];
  missingMandatoryConfluenceNames: string[];
  /** Every eligible confluence that wasn't selected (mandatory + optional). */
  missingConfluenceNames: string[];
  /** Selections that are NOT eligible for this direction (e.g. a bull-only
   *  confluence left over from before the trade was flipped to short). */
  ineligibleSelectedConfluenceIds: string[];
  ineligibleSelectedConfluenceNames: string[];
  eligibleConfluenceIds: string[];
  selectedEligibleConfluenceIds: string[];
}

function normWeight(w: number | null | undefined): number {
  if (w == null || !Number.isFinite(w)) return 0;
  return w < 0 ? 0 : w;
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

/** Is this confluence eligible for the given trade direction? */
export function isConfluenceEligible(
  applicability: ConfluenceDirectionValue | null | undefined,
  direction: TradeDirectionValue | null,
): boolean {
  if (direction == null) return false;
  const a = applicability ?? "BOTH";
  return (
    a === "BOTH" ||
    (direction === "LONG" && a === "BULLISH") ||
    (direction === "SHORT" && a === "BEARISH")
  );
}

export function scoreConfluences(input: ConfluenceScoreInput): ConfluenceScoreResult {
  const { confluences, selectedNames, direction } = input;

  // Deduped selection set — duplicate selections can't inflate the score.
  const selected = new Set(selectedNames.map(normName));
  const isSelected = (c: ScorableConfluence) => selected.has(normName(c.name));

  let totalEligibleWeight = 0;
  let selectedEligibleWeight = 0;
  const missingMandatoryConfluenceIds: string[] = [];
  const missingMandatoryConfluenceNames: string[] = [];
  const missingConfluenceNames: string[] = [];
  const ineligibleSelectedConfluenceIds: string[] = [];
  const ineligibleSelectedConfluenceNames: string[] = [];
  const eligibleConfluenceIds: string[] = [];
  const selectedEligibleConfluenceIds: string[] = [];

  for (const c of confluences) {
    const eligible = isConfluenceEligible(c.directionApplicability, direction);
    if (!eligible) {
      if (isSelected(c)) {
        ineligibleSelectedConfluenceIds.push(c.id);
        ineligibleSelectedConfluenceNames.push(c.name);
      }
      continue;
    }
    eligibleConfluenceIds.push(c.id);
    const w = normWeight(c.weight);
    totalEligibleWeight += w;
    if (isSelected(c)) {
      selectedEligibleWeight += w;
      selectedEligibleConfluenceIds.push(c.id);
    } else {
      missingConfluenceNames.push(c.name);
      if (c.mandatory) {
        missingMandatoryConfluenceIds.push(c.id);
        missingMandatoryConfluenceNames.push(c.name);
      }
    }
  }

  const score =
    totalEligibleWeight > 0
      ? Math.round((selectedEligibleWeight / totalEligibleWeight) * 100)
      : null;

  return {
    score,
    rating: score == null ? null : ratingForScore(score),
    selectedEligibleWeight,
    totalEligibleWeight,
    // No direction yet → nothing is confirmable.
    mandatoryRequirementsMet: direction != null && missingMandatoryConfluenceIds.length === 0,
    missingMandatoryConfluenceIds,
    missingMandatoryConfluenceNames,
    missingConfluenceNames,
    ineligibleSelectedConfluenceIds,
    ineligibleSelectedConfluenceNames,
    eligibleConfluenceIds,
    selectedEligibleConfluenceIds,
  };
}
