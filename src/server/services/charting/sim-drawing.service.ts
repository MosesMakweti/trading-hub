/**
 * Chart drawings on a simulation account (Strategy Lab / Prop Firm terminal),
 * per instrument. Same model and validation as Native Replay drawings
 * (domain/native-replay/drawings/model.ts), owned by the account instead of
 * a Backtest Run. A database trigger also enforces that a drawing and its
 * account belong to the same user.
 *
 * Drawings are chart objects, never market data or orders: they don't touch
 * the account's clock, ledger or rules. Accounts that are no longer active
 * keep their drawings readable but frozen.
 */
import { Prisma, type SimAccount, type SimChartDrawing } from "@prisma/client";

import { prisma } from "@/server/db";
import { MAX_DRAWINGS_PER_ASSET, validateDrawing, type ChartDrawing, type DrawingType } from "@/domain/native-replay/drawings/model";
import { requireSimAccount } from "@/server/services/simulation/sim-account.service";
import { ChartingError } from "./charting.service";

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const WRITABLE = new Set(["CREATED", "ACTIVE"]);

function toDTO(row: SimChartDrawing): ChartDrawing {
  return {
    id: row.id,
    type: row.type as DrawingType,
    assetSymbol: row.assetSymbol,
    anchors: row.anchors as unknown as ChartDrawing["anchors"],
    style: row.style as unknown as ChartDrawing["style"],
    data: row.data as unknown as ChartDrawing["data"],
    locked: row.locked,
    hidden: row.hidden,
    linkedTradeId: null,
  };
}

async function resolve(userId: string, accountId: string, assetSymbol: string, mode: "read" | "write"): Promise<SimAccount> {
  const account = await requireSimAccount(userId, accountId);
  if (!account.assets.includes(assetSymbol)) throw new ChartingError(`${assetSymbol} isn't one of this account's instruments.`);
  if (mode === "write" && !WRITABLE.has(account.status)) throw new ChartingError("This account has ended — its drawings can be viewed but not changed.");
  return account;
}

export async function listSimDrawings(userId: string, accountId: string, assetSymbol: string): Promise<ChartDrawing[]> {
  const account = await resolve(userId, accountId, assetSymbol, "read");
  const rows = await prisma.simChartDrawing.findMany({ where: { userId, accountId: account.id, assetSymbol }, orderBy: { createdAt: "asc" } });
  return rows.map(toDTO);
}

/** Upsert keyed by the client id, so undo can restore a deleted drawing with its identity. */
export async function saveSimDrawing(userId: string, accountId: string, drawing: Omit<ChartDrawing, "linkedTradeId">): Promise<ChartDrawing> {
  const account = await resolve(userId, accountId, drawing.assetSymbol, "write");
  if (!ID_PATTERN.test(drawing.id)) throw new ChartingError("Invalid drawing id.");
  const issues = validateDrawing(drawing);
  if (issues.length) throw new ChartingError(issues[0]);
  const existing = await prisma.simChartDrawing.findUnique({ where: { id: drawing.id } });
  if (existing && (existing.userId !== userId || existing.accountId !== account.id || existing.assetSymbol !== drawing.assetSymbol)) throw new ChartingError("Drawing not found.");
  // The order link is the server's: a client can neither forge nor clear it.
  const { orderRef: _ignored, ...clientData } = drawing.data;
  void _ignored;
  const storedRef = existing ? (existing.data as ChartDrawing["data"] | null)?.orderRef : undefined;
  const data: ChartDrawing["data"] = storedRef ? { ...clientData, orderRef: storedRef } : clientData;
  const fields = {
    type: drawing.type,
    anchors: drawing.anchors as unknown as Prisma.InputJsonValue,
    style: drawing.style as unknown as Prisma.InputJsonValue,
    data: data as unknown as Prisma.InputJsonValue,
    locked: drawing.locked,
    hidden: drawing.hidden,
  };
  if (existing) {
    if (existing.type !== drawing.type) throw new ChartingError("A drawing can't change type.");
    return toDTO(await prisma.simChartDrawing.update({ where: { id: existing.id }, data: fields }));
  }
  const count = await prisma.simChartDrawing.count({ where: { accountId: account.id, assetSymbol: drawing.assetSymbol } });
  if (count >= MAX_DRAWINGS_PER_ASSET) throw new ChartingError(`A chart can hold up to ${MAX_DRAWINGS_PER_ASSET} drawings.`);
  try {
    return toDTO(await prisma.simChartDrawing.create({ data: { id: drawing.id, userId, accountId: account.id, assetSymbol: drawing.assetSymbol, ...fields } }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ChartingError("Drawing not found.");
    throw error;
  }
}

export async function deleteSimDrawing(userId: string, accountId: string, assetSymbol: string, drawingId: string): Promise<void> {
  const account = await resolve(userId, accountId, assetSymbol, "write");
  const r = await prisma.simChartDrawing.deleteMany({ where: { id: drawingId, userId, accountId: account.id, assetSymbol } });
  if (r.count === 0) throw new ChartingError("Drawing not found.");
}

/**
 * Before an order is placed from a position drawing: the drawing must be the
 * trader's, on this account and instrument, and its direction must match the
 * order's side. Returns the drawing.
 */
export async function requireOrderDrawing(userId: string, accountId: string, symbol: string, drawingId: string, side: "BUY" | "SELL"): Promise<ChartDrawing> {
  const account = await resolve(userId, accountId, symbol, "write");
  const row = await prisma.simChartDrawing.findFirst({ where: { id: drawingId, userId, accountId: account.id, assetSymbol: symbol } });
  if (!row) throw new ChartingError("The linked position drawing wasn't found.");
  if (row.type !== "LONG" && row.type !== "SHORT") throw new ChartingError("Only long or short position drawings can be linked to an order.");
  if ((row.type === "LONG") !== (side === "BUY")) throw new ChartingError(`A ${row.type === "LONG" ? "long" : "short"} position drawing can't place a ${side === "BUY" ? "buy" : "sell"} order.`);
  return toDTO(row);
}

/** After the order is accepted: record it on the drawing (server-side only). */
export async function linkDrawingToOrder(userId: string, accountId: string, drawingId: string, ref: NonNullable<ChartDrawing["data"]["orderRef"]>): Promise<ChartDrawing> {
  const account = await requireSimAccount(userId, accountId);
  const row = await prisma.simChartDrawing.findFirst({ where: { id: drawingId, userId, accountId: account.id } });
  if (!row) throw new ChartingError("Drawing not found.");
  const data = { ...((row.data as ChartDrawing["data"] | null) ?? {}), orderRef: ref };
  return toDTO(await prisma.simChartDrawing.update({ where: { id: row.id }, data: { data: data as unknown as Prisma.InputJsonValue } }));
}
