import { prisma } from "@/server/db";
import { buildActualVsReplayComparison } from "@/domain/replay-comparison/comparison";
import { listReplayTrades } from "@/server/services/replay-trade.service";
import { listComparisonLinks, listOpportunityConfirmations } from "@/server/services/replay-comparison-link.service";
import type { ActualVsReplayComparison } from "@/domain/replay-comparison/types";
import type { ReplayActualBaseline, ReplayReviewStatus } from "@/types/replay";

/**
 * Actual vs Replay Comparison (Stage 15, matching upgraded Stage 15.1,
 * completed Stage 15.2) — loads the session's frozen `actualBaselineSnapshot`
 * (never recomputed here; Comparison must show the SAME frozen numbers
 * Overview already shows), its `ReplayTrade` list, any trader-confirmed
 * manual match corrections, and any missed-opportunity confirmations
 * (`ReplayComparisonLink`), then hands all of it to the pure domain
 * builder. Returns null when the review hasn't been started yet (no frozen
 * baseline to compare against) — the caller decides what to render for
 * that case, this service makes no UI decisions.
 *
 * DERIVATION, NOT PERSISTENCE (§27) — nothing here writes a comparison
 * result anywhere; every call recomputes from the three inputs above, so
 * Comparison can never hold a stale view of its own sources.
 */
export async function getReplayComparison(userId: string, sessionId: string): Promise<ActualVsReplayComparison | null> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { actualBaselineSnapshot: true, status: true },
  });
  if (!session?.actualBaselineSnapshot) return null;

  const baseline = session.actualBaselineSnapshot as unknown as ReplayActualBaseline;
  const [replayTrades, manualLinks, opportunityData] = await Promise.all([
    listReplayTrades(userId, sessionId),
    listComparisonLinks(userId, sessionId),
    listOpportunityConfirmations(userId, sessionId),
  ]);
  return buildActualVsReplayComparison(
    baseline,
    replayTrades,
    manualLinks,
    opportunityData.confirmations,
    opportunityData.confirmedAtByReplayTradeId,
    session.status as ReplayReviewStatus,
  );
}
