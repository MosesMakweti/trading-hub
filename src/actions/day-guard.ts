import { prisma } from "@/server/db";
import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";

/**
 * Action-layer wrapper around {@link assertDayEditable}: returns a ready-to-return
 * failure result when the day is archived, or null when the mutation may proceed.
 * Keeps every dated action's guard to two lines and translates the domain error
 * into the shared `{ success: false }` shape rather than throwing to the client.
 */
export async function dayEditableGuard(
  userId: string,
  dateKey: string,
): Promise<{ success: false; error: string } | null> {
  try {
    await assertDayEditable(userId, dateKey);
    return null;
  } catch (e) {
    if (e instanceof DayArchivedError) return { success: false, error: e.message };
    throw e;
  }
}

/**
 * Close Trading Day (Stage 8 §7) — a NARROW carve-out of dayEditableGuard for
 * one specific trade's own execution/review fields (updateTradeSection),
 * not a general reopening of the archived day. A trading day can now
 * legitimately close while a trade is still PARTIALLY_CLOSED/STILL_HOLDING
 * (Stage 8 §3); this lets the trader keep recording that ONE carried-open
 * trade's actual exit/notes afterward without reopening the whole day (every
 * OTHER dated action — Today's Plan, Asset Analysis, other trades — stays
 * fully locked, since this only ever looks at the named trade).
 */
export async function tradeExecutionEditableGuard(
  userId: string,
  dateKey: string,
  tradeId: string,
): Promise<{ success: false; error: string } | null> {
  const blocked = await dayEditableGuard(userId, dateKey);
  if (!blocked) return null;

  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: {
      reviewLifecycleStatus: true,
      actualEntry: true,
      actualRR: true,
      performanceRiskSnapshot: { select: { settledAt: true } },
    },
  });
  if (trade?.reviewLifecycleStatus === "PARTIALLY_CLOSED" || trade?.reviewLifecycleStatus === "STILL_HOLDING") {
    return null;
  }
  // Today V3 (Phase 2) — an entered position that is still open (no closed
  // result, Performance not settled, not marked fully closed/cancelled) must
  // stay manageable after its day archives, even if the trader never set a
  // review status: managing/closing an existing position is never locked.
  if (
    trade &&
    trade.actualEntry != null &&
    trade.actualRR == null &&
    trade.performanceRiskSnapshot?.settledAt == null &&
    trade.reviewLifecycleStatus !== "FULLY_CLOSED" &&
    trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED"
  ) {
    return null;
  }
  return blocked;
}
