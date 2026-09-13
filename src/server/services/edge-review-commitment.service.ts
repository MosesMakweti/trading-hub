import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import type {
  EdgeReviewCommitment,
  EdgeReviewCommitmentCategory,
  EdgeReviewCommitmentDailyStatus,
  EdgeReviewCommitmentPriority,
  EdgeReviewCommitmentStatus,
  ReplayReviewType,
} from "@prisma/client";
import type { EdgeReviewCommitmentDTO, TodayCommitmentsDTO } from "@/types/edge-improvements";

/**
 * Improvement Commitments (Stage 16 §6-21) — a durable record the trader
 * explicitly approves, either self-authored (§8, `source: MANUAL`) or
 * accepted from a deterministic suggestion (§9-10, `source: SUGGESTED`,
 * freezing `sourceFindingType`/`evidenceSnapshot` at accept time so the
 * evidence stays historical even if the underlying comparison were somehow
 * recomputed differently later — §28). Never auto-created: every write
 * path here is a trader action.
 */

function toDTO(row: EdgeReviewCommitment): EdgeReviewCommitmentDTO {
  return {
    id: row.id,
    replayReviewSessionId: row.replayReviewSessionId,
    reviewType: row.reviewType,
    periodStart: utcDateToKey(row.periodStart),
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    source: row.source,
    sourceFindingType: row.sourceFindingType,
    evidenceSnapshot: (row.evidenceSnapshot as string[] | null) ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ownedSession(userId: string, sessionId: string) {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, reviewType: true, startDate: true },
  });
  if (!session) throw new Error("Review session not found.");
  return session;
}

/** §8 — trader-authored, fast to create (title/description/category/priority only). */
export async function createManualCommitment(
  userId: string,
  sessionId: string,
  input: { category: EdgeReviewCommitmentCategory; title: string; description: string | null; priority: EdgeReviewCommitmentPriority },
): Promise<EdgeReviewCommitmentDTO> {
  const session = await ownedSession(userId, sessionId);
  const row = await prisma.edgeReviewCommitment.create({
    data: {
      userId,
      replayReviewSessionId: session.id,
      reviewType: session.reviewType,
      periodStart: session.startDate,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: "MANUAL",
    },
  });
  return toDTO(row);
}

/** §9-10 — turns a deterministic `SuggestedCommitment` (domain/replay-
 *  improvements) into a durable record. The trader may have edited the
 *  title/description/category/priority before accepting; whatever they
 *  submit here is what's frozen. */
export async function acceptSuggestedCommitment(
  userId: string,
  sessionId: string,
  input: {
    category: EdgeReviewCommitmentCategory;
    title: string;
    description: string | null;
    priority: EdgeReviewCommitmentPriority;
    ruleKey: string;
    evidence: string[];
  },
): Promise<EdgeReviewCommitmentDTO> {
  const session = await ownedSession(userId, sessionId);
  const row = await prisma.edgeReviewCommitment.create({
    data: {
      userId,
      replayReviewSessionId: session.id,
      reviewType: session.reviewType,
      periodStart: session.startDate,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: "SUGGESTED",
      sourceFindingType: input.ruleKey,
      evidenceSnapshot: input.evidence,
    },
  });
  return toDTO(row);
}

export async function updateCommitment(
  userId: string,
  id: string,
  patch: Partial<{ category: EdgeReviewCommitmentCategory; title: string; description: string | null; priority: EdgeReviewCommitmentPriority }>,
): Promise<void> {
  const result = await prisma.edgeReviewCommitment.updateMany({ where: { id, userId }, data: patch });
  if (result.count === 0) throw new Error("Commitment not found.");
}

/** §14 — ACTIVE/COMPLETED/RETIRED lifecycle. Stamps/clears `completedAt`/
 *  `retiredAt` to match; reactivating back to ACTIVE clears both (a
 *  commitment is never "completed and also currently active"). */
export async function setCommitmentStatus(userId: string, id: string, status: EdgeReviewCommitmentStatus): Promise<void> {
  const now = new Date();
  const result = await prisma.edgeReviewCommitment.updateMany({
    where: { id, userId },
    data: {
      status,
      completedAt: status === "COMPLETED" ? now : null,
      retiredAt: status === "RETIRED" ? now : null,
    },
  });
  if (result.count === 0) throw new Error("Commitment not found.");
}

export async function listCommitmentsForSession(userId: string, sessionId: string): Promise<EdgeReviewCommitmentDTO[]> {
  const rows = await prisma.edgeReviewCommitment.findMany({
    where: { userId, replayReviewSessionId: sessionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

async function latestFinalizedSessionId(userId: string, reviewType: ReplayReviewType): Promise<string | null> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { userId, reviewType, reviewFinalizedAt: { not: null } },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
  return session?.id ?? null;
}

async function listActiveCommitmentsForSession(userId: string, sessionId: string): Promise<EdgeReviewCommitmentDTO[]> {
  const rows = await prisma.edgeReviewCommitment.findMany({
    where: { userId, replayReviewSessionId: sessionId, status: "ACTIVE" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

/**
 * Today's carry-forward (Stage 16 §15-16) — "latest finalized review wins"
 * precedence, kept deliberately simple: for each of WEEKLY/MONTHLY
 * independently, find the most recently-STARTED review that has actually
 * been finalized (`reviewFinalizedAt` set — see ReplayReviewSession's own
 * doc comment for why that's distinct from `status: COMPLETED`), then
 * return only its still-ACTIVE commitments. A newer finalized review of the
 * same type automatically supersedes the old one (its commitments simply
 * stop being the "latest"), without deleting or mutating anything — the
 * older session's own commitments remain visible from ITS OWN Edge Review
 * page forever (§21). Weekly and monthly are always returned as two
 * separate groups, never merged (§16).
 */
export async function getActiveCommitmentsForToday(userId: string): Promise<TodayCommitmentsDTO> {
  const [weeklySessionId, monthlySessionId] = await Promise.all([
    latestFinalizedSessionId(userId, "WEEKLY"),
    latestFinalizedSessionId(userId, "MONTHLY"),
  ]);
  const [weekly, monthly] = await Promise.all([
    weeklySessionId ? listActiveCommitmentsForSession(userId, weeklySessionId) : Promise.resolve([]),
    monthlySessionId ? listActiveCommitmentsForSession(userId, monthlySessionId) : Promise.resolve([]),
  ]);
  return { weekly, monthly };
}

// ── Daily acknowledgement (Stage 16 §18) — optional, separate from the
// commitment record itself; never rewrites historical review data (§17). ──

export async function setCommitmentDailyState(
  userId: string,
  commitmentId: string,
  dateKey: Date,
  status: EdgeReviewCommitmentDailyStatus,
): Promise<void> {
  const commitment = await prisma.edgeReviewCommitment.findFirst({ where: { id: commitmentId, userId }, select: { id: true } });
  if (!commitment) throw new Error("Commitment not found.");

  await prisma.edgeReviewCommitmentDailyState.upsert({
    where: { commitmentId_dateKey: { commitmentId, dateKey } },
    create: { userId, commitmentId, dateKey, status },
    update: { status },
  });
}

export async function getCommitmentDailyStates(
  userId: string,
  commitmentIds: string[],
  dateKey: Date,
): Promise<Map<string, EdgeReviewCommitmentDailyStatus>> {
  if (commitmentIds.length === 0) return new Map();
  const rows = await prisma.edgeReviewCommitmentDailyState.findMany({
    where: { userId, commitmentId: { in: commitmentIds }, dateKey },
    select: { commitmentId: true, status: true },
  });
  return new Map(rows.map((r) => [r.commitmentId, r.status]));
}
