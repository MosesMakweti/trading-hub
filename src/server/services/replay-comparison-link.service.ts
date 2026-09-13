import { prisma } from "@/server/db";
import type { ManualComparisonLink, OpportunityConfirmation } from "@/domain/replay-comparison/types";

/**
 * Manual match-correction + missed-opportunity confirmation persistence
 * (Stage 15.1 §16, extended Stage 15.2 §5-6/§16) — a trader's
 * confirmation/correction of an Actual-vs-Replay pairing, or their
 * confirm/reject decision on a Potential Missed Opportunity, stored so it
 * survives reloads and takes priority over the deterministic matcher's own
 * scoring (domain/replay-comparison/decision-matching.ts). Never mutates
 * Trade or ReplayTrade — every write here lands only on
 * `ReplayComparisonLink`.
 *
 * `actualTradeId` deliberately has no FK relation to Trade (see the
 * schema's own doc comment on `ReplayComparisonLink`) and is null for an
 * `OPPORTUNITY` row (no Actual trade exists to pair a missed opportunity
 * with); ownership is checked here at the application layer on every write.
 */

export interface ComparisonLinkRow {
  id: string;
  actualTradeId: string | null;
  replayTradeId: string;
  linkType: "MATCHED" | "EXCLUDED" | "OPPORTUNITY";
  opportunityClassification: string | null;
  confirmedAt: string | null;
}

async function listRawComparisonLinks(userId: string, sessionId: string): Promise<ComparisonLinkRow[]> {
  const owned = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!owned) return [];

  const rows = await prisma.replayComparisonLink.findMany({
    where: { replayReviewSessionId: sessionId, userId },
    select: { id: true, actualTradeId: true, replayTradeId: true, linkType: true, opportunityClassification: true, confirmedAt: true },
  });
  return rows.map((r) => ({ ...r, confirmedAt: r.confirmedAt?.toISOString() ?? null }));
}

/** MATCHED/EXCLUDED rows only — the shape `matchActualToReplayDecisions`
 *  consumes to override its own scoring. */
export async function listComparisonLinks(userId: string, sessionId: string): Promise<ManualComparisonLink[]> {
  const rows = await listRawComparisonLinks(userId, sessionId);
  return rows
    .filter((r): r is ComparisonLinkRow & { actualTradeId: string; linkType: "MATCHED" | "EXCLUDED" } =>
      (r.linkType === "MATCHED" || r.linkType === "EXCLUDED") && r.actualTradeId != null,
    )
    .map((r) => ({ actualTradeId: r.actualTradeId, replayTradeId: r.replayTradeId, linkType: r.linkType }));
}

/** OPPORTUNITY rows only — the trader's confirm/reject decisions on
 *  Potential Missed Opportunities, plus a `replayTradeId -> confirmedAt`
 *  lookup for display. */
export async function listOpportunityConfirmations(
  userId: string,
  sessionId: string,
): Promise<{ confirmations: OpportunityConfirmation[]; confirmedAtByReplayTradeId: Map<string, string | null> }> {
  const rows = await listRawComparisonLinks(userId, sessionId);
  const opportunityRows = rows.filter((r) => r.linkType === "OPPORTUNITY");
  const confirmations: OpportunityConfirmation[] = opportunityRows
    .filter((r) => r.opportunityClassification === "CONFIRMED_MISSED" || r.opportunityClassification === "NOT_MISSED")
    .map((r) => ({ replayTradeId: r.replayTradeId, classification: r.opportunityClassification as "CONFIRMED_MISSED" | "NOT_MISSED" }));
  const confirmedAtByReplayTradeId = new Map(opportunityRows.map((r) => [r.replayTradeId, r.confirmedAt]));
  return { confirmations, confirmedAtByReplayTradeId };
}

export async function listComparisonLinksForUI(userId: string, sessionId: string): Promise<ComparisonLinkRow[]> {
  return listRawComparisonLinks(userId, sessionId);
}

export async function createManualComparisonLink(
  userId: string,
  sessionId: string,
  input: { actualTradeId: string; replayTradeId: string; linkType: "MATCHED" | "EXCLUDED" },
): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw new Error("Review session not found.");

  const [actualTrade, replayTrade] = await Promise.all([
    prisma.trade.findFirst({ where: { id: input.actualTradeId, userId }, select: { id: true } }),
    prisma.replayTrade.findFirst({ where: { id: input.replayTradeId, userId, sessionId }, select: { id: true } }),
  ]);
  if (!actualTrade) throw new Error("Actual trade not found.");
  if (!replayTrade) throw new Error("Replay decision not found in this session.");

  await prisma.replayComparisonLink.upsert({
    where: {
      replayReviewSessionId_actualTradeId_replayTradeId: {
        replayReviewSessionId: sessionId,
        actualTradeId: input.actualTradeId,
        replayTradeId: input.replayTradeId,
      },
    },
    create: {
      userId,
      replayReviewSessionId: sessionId,
      actualTradeId: input.actualTradeId,
      replayTradeId: input.replayTradeId,
      linkType: input.linkType,
      source: "MANUAL",
      confirmedAt: new Date(),
    },
    update: { linkType: input.linkType, source: "MANUAL", confirmedAt: new Date() },
  });
}

/**
 * Confirm/reject a "Potential Missed Opportunity" (Stage 15.2 §5) — a
 * Replay TAKEN decision with no matching Actual trade. Find-or-update by
 * (sessionId, replayTradeId, linkType: OPPORTUNITY) rather than relying on
 * the table's own unique index, since Postgres treats every NULL
 * `actualTradeId` as distinct (documented on the schema).
 */
export async function setMissedOpportunityClassification(
  userId: string,
  sessionId: string,
  replayTradeId: string,
  classification: "CONFIRMED_MISSED" | "NOT_MISSED",
): Promise<void> {
  const [session, replayTrade] = await Promise.all([
    prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } }),
    prisma.replayTrade.findFirst({ where: { id: replayTradeId, userId, sessionId }, select: { id: true } }),
  ]);
  if (!session) throw new Error("Review session not found.");
  if (!replayTrade) throw new Error("Replay decision not found in this session.");

  const existing = await prisma.replayComparisonLink.findFirst({
    where: { replayReviewSessionId: sessionId, replayTradeId, linkType: "OPPORTUNITY" },
    select: { id: true },
  });

  if (existing) {
    await prisma.replayComparisonLink.update({
      where: { id: existing.id },
      data: { opportunityClassification: classification, confirmedAt: new Date() },
    });
  } else {
    await prisma.replayComparisonLink.create({
      data: {
        userId,
        replayReviewSessionId: sessionId,
        actualTradeId: null,
        replayTradeId,
        linkType: "OPPORTUNITY",
        source: "MANUAL",
        opportunityClassification: classification,
        confirmedAt: new Date(),
      },
    });
  }
}

export async function deleteComparisonLink(userId: string, id: string): Promise<void> {
  const result = await prisma.replayComparisonLink.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Comparison link not found.");
}

/** Remove/reset a manual match correction by the pair it links (§2's
 *  "remove/reset manual match") — the UI only ever knows the two trade ids,
 *  never the link's own row id. Returns that specific pair to the
 *  algorithm's own auto-matching. */
export async function deleteComparisonLinkForPair(
  userId: string,
  sessionId: string,
  actualTradeId: string,
  replayTradeId: string,
): Promise<void> {
  const result = await prisma.replayComparisonLink.deleteMany({
    where: { userId, replayReviewSessionId: sessionId, actualTradeId, replayTradeId, linkType: { in: ["MATCHED", "EXCLUDED"] } },
  });
  if (result.count === 0) throw new Error("Comparison link not found.");
}
