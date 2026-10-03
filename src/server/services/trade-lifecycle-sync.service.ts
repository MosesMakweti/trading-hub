import { prisma } from "@/server/db";
import { isBacktestScope } from "@/server/workspace/scope";
import { exitedPercentFrom } from "@/domain/trades/trade-lifecycle";
import { nextClosedAt } from "@/domain/trades/lifecycle";
import { closedMomentFrom, deriveReviewState } from "@/domain/trades/review-state";

/**
 * Today V3 (Phase 3) — the ONE service that keeps a LIVE trade's stored
 * lifecycle columns in step with its canonical execution facts, so the
 * trader is never asked "what state is this trade in?" routinely:
 *
 *  - reviewLifecycleStatus ← STILL_HOLDING / PARTIALLY_CLOSED / FULLY_CLOSED
 *    from exited % and Performance settlement (Close Day, carried positions
 *    and the archived-day edit guard read it). CANCELLED_NEVER_TRIGGERED is
 *    never touched; trades with no actual entry are never touched.
 *  - closedAt ← stamped the first time the position is fully closed
 *    (preserved after that), cleared if an exit edit re-opens it. It is the
 *    close moment the interim-vs-final review derivation compares
 *    reviewedAt against (domain/trades/review-state.ts).
 *  - status (legacy OPEN/CLOSED/REVIEWED materialization) ← OPEN until fully
 *    closed, REVIEWED only once the V3 FINAL review is complete.
 *
 * Backtesting/Replay keep their V2 manual flow — this is a no-op there.
 * Idempotent; writes only when something differs.
 */
export async function syncLiveTradeLifecycle(userId: string, tradeId: string, now = new Date()): Promise<void> {
  if (isBacktestScope()) return;
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: {
      actualEntry: true,
      actualExit: true,
      actualRR: true,
      backtestRunId: true,
      closedAt: true,
      reviewedAt: true,
      status: true,
      reviewLifecycleStatus: true,
      tradeIntent: true,
      adherenceAnswers: true,
      wouldTakeAgain: true,
      psychology: { select: { id: true } },
      performanceRiskSnapshot: { select: { settledAt: true } },
      actualPartialExits: { select: { percentClosed: true, exitedAt: true } },
    },
  });
  if (!trade || trade.backtestRunId != null) return;
  if (trade.actualEntry == null || trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED") return;

  const exited = exitedPercentFrom(
    trade.actualPartialExits.map((p) => ({ percentClosed: p.percentClosed ? p.percentClosed.toNumber() : null })),
    trade.actualExit ? trade.actualExit.toNumber() : null,
  );
  const settled = trade.performanceRiskSnapshot?.settledAt != null;
  const closed = (exited ?? 0) >= 100 - 1e-6 || settled;
  // A manually recorded legacy result (actualRR) without closing execution
  // facts: leave its legacy stamps exactly as they are.
  if (!closed && trade.actualRR != null) return;

  const reviewLifecycleStatus = closed ? "FULLY_CLOSED" : (exited ?? 0) > 1e-6 ? "PARTIALLY_CLOSED" : "STILL_HOLDING";
  const closedAt = nextClosedAt(trade.closedAt, closed, now);
  const review = deriveReviewState({
    cancelled: false,
    hasActualEntry: true,
    hasLegacyResult: false,
    closed,
    closedMoment: closedMomentFrom(
      closedAt,
      trade.performanceRiskSnapshot?.settledAt ?? null,
      trade.actualPartialExits.map((p) => p.exitedAt),
    ),
    reviewedAt: trade.reviewedAt,
    answers: {
      tradeIntent: trade.tradeIntent,
      adherenceAnswers: (trade.adherenceAnswers as Record<string, boolean> | null) ?? {},
      wouldTakeAgain: trade.wouldTakeAgain,
    },
  });
  const status = !closed ? "OPEN" : review.state === "FINAL_REVIEW_COMPLETE" ? "REVIEWED" : "CLOSED";

  if (
    trade.reviewLifecycleStatus === reviewLifecycleStatus &&
    trade.closedAt?.getTime() === closedAt?.getTime() &&
    trade.status === status
  ) {
    return;
  }
  await prisma.trade.update({ where: { id: tradeId }, data: { reviewLifecycleStatus, closedAt, status } });
}
