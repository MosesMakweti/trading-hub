// Today V3 (Phase 3) — the ONE place a trade's REVIEW state is derived.
// Pure; no stored review enum. Inputs are existing canonical facts:
// actual entry, exited % / Performance settlement (→ closed), the
// cancellation status, Trade.closedAt (the moment the position became fully
// closed — kept in sync from execution facts for LIVE trades by
// trade-lifecycle-sync.service.ts), Trade.reviewedAt (the latest explicit
// review completion) and the structured review answers.
//
// Interim vs final without a schema change:
//  - A review completed while the position is still open stamps reviewedAt
//    BEFORE the close moment, so once the position fully closes,
//    reviewedAt < closedAt and the trade is FINAL_REVIEW_REQUIRED again.
//  - The final Complete Review stamps reviewedAt AFTER the close moment.
//  - Free text alone never completes a final review: the structured
//    requirements below must all be present too.

import { ADHERENCE_QUESTIONS } from "./adherence";

export type ReviewState =
  | "NOT_AVAILABLE"
  | "CANCELLED"
  | "INTERIM_AVAILABLE"
  | "INTERIM_REVIEWED"
  | "FINAL_REVIEW_REQUIRED"
  | "FINAL_REVIEW_COMPLETE";

export interface ReviewAnswersFacts {
  tradeIntent: string | null;
  adherenceAnswers: Record<string, boolean>;
  /** A scored questionnaire row exists (all 8 canonical keys answered). */
  psychologyComplete: boolean;
  wouldTakeAgain: boolean | null;
}

export interface ReviewRequirement {
  key: string;
  label: string;
}

/** The structured minimum for a FINAL review. Reflection text is optional. */
export function missingReviewRequirements(a: ReviewAnswersFacts): ReviewRequirement[] {
  const missing: ReviewRequirement[] = [];
  if (a.tradeIntent == null) missing.push({ key: "tradeIntent", label: "Why did I take this trade? (motive)" });
  for (const q of ADHERENCE_QUESTIONS) {
    if (typeof a.adherenceAnswers[q.key] !== "boolean") missing.push({ key: `adherence.${q.key}`, label: q.prompt });
  }
  if (!a.psychologyComplete) missing.push({ key: "psychology", label: "Psychology questions" });
  if (a.wouldTakeAgain == null) missing.push({ key: "wouldTakeAgain", label: "Would I take this setup again?" });
  return missing;
}

export interface ReviewStateFacts {
  cancelled: boolean;
  hasActualEntry: boolean;
  /** Imported/legacy result with no actual entry (actualRR only). */
  hasLegacyResult: boolean;
  /** Fully exited or Performance-settled (deriveTradeLifecycle's `closed`). */
  closed: boolean;
  /** When the position became fully closed: Trade.closedAt, else the best
   *  canonical close fact available (Performance settledAt / last exit time).
   *  Null when no close moment is recorded at all (legacy). */
  closedMoment: Date | null;
  reviewedAt: Date | null;
  answers: ReviewAnswersFacts;
}

export interface ReviewStateResult {
  state: ReviewState;
  missing: ReviewRequirement[];
  /** reviewedAt exists but doesn't satisfy V3 final completion — a legacy,
   *  text-only, or interim review on a trade that has since closed. */
  hasEarlierReview: boolean;
}

export function deriveReviewState(f: ReviewStateFacts): ReviewStateResult {
  const missing = missingReviewRequirements(f.answers);
  if (f.cancelled && !f.hasActualEntry) return { state: "CANCELLED", missing: [], hasEarlierReview: false };
  if (!f.hasActualEntry && !f.hasLegacyResult) return { state: "NOT_AVAILABLE", missing, hasEarlierReview: false };

  if (!f.closed) {
    return {
      state: f.reviewedAt != null ? "INTERIM_REVIEWED" : "INTERIM_AVAILABLE",
      missing,
      hasEarlierReview: false,
    };
  }

  const reviewedAfterClose =
    f.reviewedAt != null && (f.closedMoment == null || f.reviewedAt.getTime() >= f.closedMoment.getTime());
  if (reviewedAfterClose && missing.length === 0) {
    return { state: "FINAL_REVIEW_COMPLETE", missing, hasEarlierReview: false };
  }
  return { state: "FINAL_REVIEW_REQUIRED", missing, hasEarlierReview: f.reviewedAt != null };
}

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  NOT_AVAILABLE: "Not available",
  CANCELLED: "Cancelled idea",
  INTERIM_AVAILABLE: "Interim review available",
  INTERIM_REVIEWED: "Interim review saved",
  FINAL_REVIEW_REQUIRED: "Final review required",
  FINAL_REVIEW_COMPLETE: "Review complete",
};

/** The latest of the canonical close facts, for trades whose closedAt was
 *  never synced (legacy / extension-closed). */
export function closedMomentFrom(
  closedAt: Date | null,
  settledAt: Date | null,
  exitTimes: Date[],
): Date | null {
  if (closedAt) return closedAt;
  const candidates = [settledAt, ...exitTimes].filter((d): d is Date => d != null);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}
