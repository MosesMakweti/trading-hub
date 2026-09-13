import { prisma } from "@/server/db";
import type { CreateReplayAnnotationInput } from "@/lib/validation/replay";
import type { ReplayAnnotationDTO } from "@/types/replay";

/**
 * Stage 18 §15-18 — the minimal Replay chart annotation layer. A REVIEW
 * artifact only: every function here writes exclusively to
 * `ReplayChartAnnotation`, scoped by session ownership — it must never
 * touch a real Trade, historical Strategy, Today Market Plan, or Journal
 * (§17). Geometry is already validated per-shape at the Zod boundary
 * (`createReplayAnnotationSchema`'s discriminated union) before it ever
 * reaches this file — this layer's own job is ownership/ mutability, not
 * re-validating shape.
 */

async function assertSessionOwnedAndMutable(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { status: true } });
  if (!session) throw new Error("Review session not found.");
  if (session.status !== "IN_PROGRESS") {
    throw new Error("This review is completed — reopen it before adding or removing drawings.");
  }
}

function toDTO(row: {
  id: string;
  assetSymbol: string;
  timeframe: string | null;
  type: string;
  geometry: unknown;
  text: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ReplayAnnotationDTO {
  return {
    id: row.id,
    assetSymbol: row.assetSymbol,
    timeframe: row.timeframe,
    type: row.type as ReplayAnnotationDTO["type"],
    geometry: row.geometry,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Viewing drawings is always allowed regardless of session status (§36 — a
 * COMPLETED session's drawings "remain visible"); only creating/removing
 * them requires IN_PROGRESS.
 */
export async function listReplayAnnotations(userId: string, sessionId: string, assetSymbol: string): Promise<ReplayAnnotationDTO[]> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw new Error("Review session not found.");
  const rows = await prisma.replayChartAnnotation.findMany({
    where: { sessionId, assetSymbol: assetSymbol.toUpperCase(), deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

export async function createReplayAnnotation(userId: string, input: CreateReplayAnnotationInput): Promise<ReplayAnnotationDTO> {
  await assertSessionOwnedAndMutable(userId, input.sessionId);
  const row = await prisma.replayChartAnnotation.create({
    data: {
      userId,
      sessionId: input.sessionId,
      assetSymbol: input.assetSymbol,
      timeframe: input.timeframe ?? null,
      type: input.type,
      geometry: input.geometry,
      text: input.text ?? null,
    },
  });
  return toDTO(row);
}

export async function deleteReplayAnnotation(userId: string, id: string): Promise<void> {
  const row = await prisma.replayChartAnnotation.findFirst({ where: { id, userId }, select: { sessionId: true } });
  if (!row) throw new Error("Annotation not found.");
  await assertSessionOwnedAndMutable(userId, row.sessionId);
  await prisma.replayChartAnnotation.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** "Clear replay drawings" (§15) — scoped to one session+asset, never the
 *  trader's whole account. */
export async function clearReplayAnnotations(userId: string, sessionId: string, assetSymbol: string): Promise<void> {
  await assertSessionOwnedAndMutable(userId, sessionId);
  await prisma.replayChartAnnotation.updateMany({
    where: { sessionId, userId, assetSymbol: assetSymbol.toUpperCase(), deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
