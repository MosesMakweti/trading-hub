/**
 * Close Trading Day (Stage 8 §4) — the ONE authoritative function that
 * reconciles the legacy Trade.status/closedAt workflow stamps
 * (domain/trades/lifecycle.ts) against the trader's own Stage 7
 * reviewLifecycleStatus, instead of scattering ad-hoc status writes across
 * components. Framework-free and pure — unit-tested directly.
 *
 * Rule: only FULLY_CLOSED ever advances closedAt/status. PARTIALLY_CLOSED
 * and STILL_HOLDING stay operationally open (no fake close timestamp — a
 * trading day may end while they're still active). CANCELLED_NEVER_TRIGGERED
 * is never forced into a closed/win/loss state — reviewLifecycleStatus alone
 * represents "this idea is finished", since the legacy TradeStatus enum has
 * no vocabulary for "cancelled" that wouldn't misrepresent it as a real
 * result. Existing review semantics are untouched: deriveStatus already
 * refuses to report REVIEWED unless reviewedAt is ALSO set (i.e. reflection
 * content exists) — closing merely supplies closedAt, never reviewedAt.
 */
import { deriveStatus, nextClosedAt, type TradeLifecycleStatus } from "@/domain/trades/lifecycle";

export type ReviewLifecycleStatusValue =
  | "FULLY_CLOSED"
  | "PARTIALLY_CLOSED"
  | "STILL_HOLDING"
  | "CANCELLED_NEVER_TRIGGERED"
  | null;

export interface TradeLifecycleReconciliationInput {
  closedAt: Date | null;
  reviewedAt: Date | null;
  reviewLifecycleStatus: ReviewLifecycleStatusValue;
  now?: Date;
}

export interface TradeLifecycleReconciliationResult {
  closedAt: Date | null;
  status: TradeLifecycleStatus;
}

/**
 * Pure — returns the RECONCILED target values; the caller (trade-review.service.ts)
 * compares these against the trade's current stored closedAt/status and only
 * writes when something actually differs, which is what makes repeated calls
 * (e.g. Close Day re-running this over every trade) idempotent and cheap.
 */
export function reconcileTradeLifecycle(
  input: TradeLifecycleReconciliationInput,
): TradeLifecycleReconciliationResult {
  const now = input.now ?? new Date();

  if (input.reviewLifecycleStatus !== "FULLY_CLOSED") {
    // PARTIALLY_CLOSED, STILL_HOLDING, CANCELLED_NEVER_TRIGGERED, or not yet
    // reviewed at all — none of these ever advance closedAt/status here.
    return { closedAt: input.closedAt, status: deriveStatus(input.closedAt, input.reviewedAt) };
  }

  const closedAt = nextClosedAt(input.closedAt, true, now);
  return { closedAt, status: deriveStatus(closedAt, input.reviewedAt) };
}
