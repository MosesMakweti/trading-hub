/**
 * Pure lifecycle-timestamp logic for the Trade Timeline (Phase 3).
 *
 * A trade's lifecycle stamps must be *sticky and honest*: the moment a trade
 * first becomes closed or reviewed is recorded once and never silently
 * rewritten by later edits. These functions decide the next stamp value from
 * the existing one plus the incoming state, so every write path
 * (create / edit form / inline section autosave) applies the same rule.
 *
 * Framework-free by design (no next/react/prisma imports) — unit-tested.
 */

/**
 * When did the trade close (a result was recorded)?
 * - Stamped once, the first time a result exists — preserved across later edits.
 * - Cleared if the result is removed (the trade is reopened).
 */
export function nextClosedAt(
  existingClosedAt: Date | null,
  hasResult: boolean,
  now: Date,
): Date | null {
  if (!hasResult) return null;
  return existingClosedAt ?? now;
}

/**
 * When was the trade first reviewed (any reflection captured)?
 * - Stamped once, the first time review content appears.
 * - Never auto-cleared: a review having happened is a historical fact, even if
 *   the text is later edited away.
 */
export function nextReviewedAt(
  existingReviewedAt: Date | null,
  hasReviewContent: boolean,
  now: Date,
): Date | null {
  if (existingReviewedAt) return existingReviewedAt;
  return hasReviewContent ? now : null;
}

/**
 * The in-market execution instant, derived from the trade's date (stored as a
 * date-only value at UTC midnight) plus its execution time in minutes-since-
 * midnight. Not persisted — it's already fully determined by existing columns.
 */
export function executedAtFromTrade(tradeDate: Date, executionMinutes: number): Date {
  return new Date(tradeDate.getTime() + executionMinutes * 60_000);
}

export type TradeLifecycleStatus = "OPEN" | "CLOSED" | "REVIEWED";

/**
 * The trade's lifecycle stage, derived from its stamps: a trade must be closed
 * before it can count as reviewed. Materialized onto Trade.status at write time
 * (from the same closedAt/reviewedAt this module computes) for indexed filtering.
 */
export function deriveStatus(
  closedAt: Date | null,
  reviewedAt: Date | null,
): TradeLifecycleStatus {
  if (closedAt && reviewedAt) return "REVIEWED";
  if (closedAt) return "CLOSED";
  return "OPEN";
}
