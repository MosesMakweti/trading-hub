/**
 * Replay foundation (Stage 12 §3) — pure validation for a review session's
 * historical period. A session ALWAYS stores explicit `startDate`/`endDate`
 * (never a lazy "last week"/"August" pointer); this module is what keeps
 * those explicit dates honest against the WEEKLY/MONTHLY convention, reusing
 * the SAME date-key/UTC-date helpers TradingDay already uses (weekStartKey =
 * Monday-start, matching the Edge weekly review) so Replay never introduces a
 * second, inconsistent notion of "week."
 */
import { addDaysToKey, isValidDateKey, monthEndKey, monthStartKey, weekStartKey } from "@/lib/date";

export type ReplayReviewTypeValue = "WEEKLY" | "MONTHLY";

export interface ReviewPeriodValidation {
  valid: boolean;
  error?: string;
}

export function validateReviewPeriod(
  reviewType: ReplayReviewTypeValue,
  startDate: string,
  endDate: string,
): ReviewPeriodValidation {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return { valid: false, error: "Invalid date." };
  }
  if (endDate < startDate) {
    return { valid: false, error: "End date must not be before start date." };
  }

  if (reviewType === "WEEKLY") {
    if (startDate !== weekStartKey(startDate)) {
      return { valid: false, error: "A weekly review must start on a Monday." };
    }
    if (endDate !== addDaysToKey(startDate, 6)) {
      return { valid: false, error: "A weekly review must span exactly Monday through Sunday." };
    }
    return { valid: true };
  }

  // MONTHLY
  if (startDate !== monthStartKey(startDate)) {
    return { valid: false, error: "A monthly review must start on the 1st of the month." };
  }
  if (endDate !== monthEndKey(startDate)) {
    return { valid: false, error: "A monthly review must span the full calendar month." };
  }
  return { valid: true };
}

/** Convenience presets for the Replay landing page's period picker — always
 *  produces an explicit, already-valid {startDate, endDate} pair for the
 *  given anchor date, so the UI never has to hand-construct a range. */
export function computeReviewPeriod(
  reviewType: ReplayReviewTypeValue,
  referenceDate: string,
): { startDate: string; endDate: string } {
  if (reviewType === "WEEKLY") {
    const startDate = weekStartKey(referenceDate);
    return { startDate, endDate: addDaysToKey(startDate, 6) };
  }
  const startDate = monthStartKey(referenceDate);
  return { startDate, endDate: monthEndKey(referenceDate) };
}
