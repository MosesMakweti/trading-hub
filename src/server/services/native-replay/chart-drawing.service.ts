/**
 * Native Replay — chart drawings (persistence and ownership).
 *
 * Drawings belong to a Backtest Run + asset. Every call verifies the run is the
 * user's and the asset is one of the run's; a drawing id that isn't in that run
 * for that user is indistinguishable from a missing one. Completed/archived
 * runs keep their drawings readable, but nothing can change them (the same
 * rule as the rest of Backtesting).
 *
 * Saving is an upsert keyed by the client-generated id, so the chart's
 * undo/redo can restore a deleted drawing with its original identity.
 */
import { Prisma, type BacktestRun, type ReplayChartDrawing } from "@prisma/client";

import { prisma } from "@/server/db";
import { normalizeSymbol } from "@/domain/native-replay/import-analysis";
import { MAX_DRAWINGS_PER_ASSET, validateDrawing, type ChartDrawing, type DrawingType } from "@/domain/native-replay/drawings/model";
import { requireBacktestRun } from "@/server/services/backtest-run.service";

export class DrawingError extends Error {}
export class DrawingNotFoundError extends Error {
  constructor() {
    super("Drawing not found.");
  }
}

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function toDTO(row: ReplayChartDrawing): ChartDrawing {
  return {
    id: row.id,
    type: row.type as DrawingType,
    assetSymbol: row.assetSymbol,
    anchors: row.anchors as unknown as ChartDrawing["anchors"],
    style: row.style as unknown as ChartDrawing["style"],
    data: row.data as unknown as ChartDrawing["data"],
    locked: row.locked,
    hidden: row.hidden,
    linkedTradeId: row.linkedTradeId,
  };
}

async function resolveRun(userId: string, runId: string, assetSymbol: string, mode: "read" | "write"): Promise<BacktestRun> {
  const run = await requireBacktestRun(userId, runId);
  if (!run.assets.includes(assetSymbol)) throw new DrawingNotFoundError();
  if (mode === "write" && run.status !== "ACTIVE") throw new DrawingError("This run is read-only — its drawings can be viewed but not changed.");
  return run;
}

export async function listDrawings(userId: string, runId: string, assetSymbol: string): Promise<ChartDrawing[]> {
  const run = await resolveRun(userId, runId, assetSymbol, "read");
  const rows = await prisma.replayChartDrawing.findMany({ where: { userId, backtestRunId: run.id, assetSymbol }, orderBy: { createdAt: "asc" } });
  return rows.map(toDTO);
}

/** Creates or updates one drawing (validated server-side; linkedTradeId is never client-writable). */
export async function saveDrawing(userId: string, runId: string, drawing: Omit<ChartDrawing, "linkedTradeId">): Promise<ChartDrawing> {
  const run = await resolveRun(userId, runId, drawing.assetSymbol, "write");
  if (!ID_PATTERN.test(drawing.id)) throw new DrawingError("Invalid drawing id.");
  const issues = validateDrawing(drawing);
  if (issues.length) throw new DrawingError(issues[0]);

  const existing = await prisma.replayChartDrawing.findUnique({ where: { id: drawing.id } });
  if (existing && (existing.userId !== userId || existing.backtestRunId !== run.id || existing.assetSymbol !== drawing.assetSymbol)) {
    throw new DrawingNotFoundError(); // someone else's id (or another run's): never overwritten
  }
  const fields = {
    type: drawing.type,
    anchors: drawing.anchors as unknown as Prisma.InputJsonValue,
    style: drawing.style as unknown as Prisma.InputJsonValue,
    data: drawing.data as unknown as Prisma.InputJsonValue,
    locked: drawing.locked,
    hidden: drawing.hidden,
  };
  if (existing) {
    if (existing.type !== drawing.type) throw new DrawingError("A drawing can't change type.");
    return toDTO(await prisma.replayChartDrawing.update({ where: { id: existing.id }, data: fields }));
  }
  const count = await prisma.replayChartDrawing.count({ where: { backtestRunId: run.id, assetSymbol: drawing.assetSymbol } });
  if (count >= MAX_DRAWINGS_PER_ASSET) throw new DrawingError(`A chart can hold up to ${MAX_DRAWINGS_PER_ASSET} drawings.`);
  try {
    return toDTO(await prisma.replayChartDrawing.create({ data: { id: drawing.id, userId, backtestRunId: run.id, assetSymbol: drawing.assetSymbol, ...fields } }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new DrawingNotFoundError();
    throw error;
  }
}

export async function deleteDrawing(userId: string, runId: string, assetSymbol: string, drawingId: string): Promise<void> {
  const run = await resolveRun(userId, runId, assetSymbol, "write");
  const deleted = await prisma.replayChartDrawing.deleteMany({ where: { id: drawingId, userId, backtestRunId: run.id, assetSymbol } });
  if (deleted.count === 0) throw new DrawingNotFoundError();
}

/**
 * Records that a position drawing was used to create a Trade Idea. One-way and
 * informational: the trade must be a trade of THIS run, for the drawing's
 * asset; nothing ever flows back from the drawing into the trade's plan.
 */
export async function linkDrawingToTrade(userId: string, runId: string, assetSymbol: string, drawingId: string, tradeId: string): Promise<void> {
  const run = await resolveRun(userId, runId, assetSymbol, "write");
  const drawing = await prisma.replayChartDrawing.findFirst({ where: { id: drawingId, userId, backtestRunId: run.id, assetSymbol } });
  if (!drawing || (drawing.type !== "LONG" && drawing.type !== "SHORT")) throw new DrawingNotFoundError();
  const [trade] = await prisma.$queryRaw<{ assetSymbol: string }[]>`
    SELECT "assetSymbol" FROM "Trade" WHERE "id" = ${tradeId} AND "userId" = ${userId} AND "backtestRunId" = ${run.id}
  `;
  if (!trade) throw new DrawingError("That trade isn't part of this run.");
  if (normalizeSymbol(trade.assetSymbol) !== normalizeSymbol(assetSymbol)) throw new DrawingError("That trade is for a different asset.");
  await prisma.replayChartDrawing.update({ where: { id: drawing.id }, data: { linkedTradeId: tradeId } });
}
