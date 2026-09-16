/**
 * Stage 21.3A §18/§21/§22 — persistence for MT5 historical-candle imports.
 * `MarketDataImport` (Postgres) is metadata/index ONLY; the normalized
 * candles themselves live in R2 (`lib/mt5-candle-storage.ts`). Every
 * function here is scoped by `userId` — imported market data belongs to
 * the user who uploaded it (§21), enforced the same way every other
 * per-user resource in this codebase is: a `where: { id, userId }` that
 * makes a foreign row simply not exist from another user's perspective,
 * never a separate authorization check bolted on afterward.
 */
import { prisma } from "@/server/db";
import { deleteImportChunks, readCandleChunksInRange, writeCandleChunks } from "@/lib/mt5-candle-storage";
import type { Candle } from "@/domain/market-data/candle";
import type { MarketDataQualityReport } from "@/domain/market-data/quality-analysis";
import type { Timeframe } from "@/domain/market-data/timeframe";
import type { Mt5ImportAcceptanceState, TimeConvention } from "@/domain/mt5-import/types";
import type { Mt5ImportStatus as PrismaMt5ImportStatus } from "@prisma/client";

export interface MarketDataImportSummaryDTO {
  id: string;
  sourceType: string;
  sourceLabel: string | null;
  sourceSymbol: string;
  canonicalSymbol: string;
  nativeTimeframe: Timeframe;
  timeConvention: TimeConvention;
  rangeFrom: string; // ISO
  rangeTo: string; // ISO
  originalFileName: string | null;
  quality: MarketDataQualityReport;
  status: Mt5ImportAcceptanceState;
  candleCount: number;
  createdAt: string; // ISO
}

function toDTO(row: {
  id: string;
  sourceType: string;
  sourceLabel: string | null;
  sourceSymbol: string;
  canonicalSymbol: string;
  nativeTimeframe: string;
  timeConventionJson: unknown;
  rangeFrom: Date;
  rangeTo: Date;
  originalFileName: string | null;
  qualitySummaryJson: unknown;
  status: PrismaMt5ImportStatus;
  candleCount: number;
  createdAt: Date;
}): MarketDataImportSummaryDTO {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    sourceSymbol: row.sourceSymbol,
    canonicalSymbol: row.canonicalSymbol,
    nativeTimeframe: row.nativeTimeframe as Timeframe,
    timeConvention: row.timeConventionJson as TimeConvention,
    rangeFrom: row.rangeFrom.toISOString(),
    rangeTo: row.rangeTo.toISOString(),
    originalFileName: row.originalFileName,
    quality: row.qualitySummaryJson as MarketDataQualityReport,
    status: row.status,
    candleCount: row.candleCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateMt5ImportInput {
  sourceSymbol: string;
  canonicalSymbol: string;
  nativeTimeframe: Timeframe;
  timeConvention: TimeConvention;
  candles: Candle[];
  quality: MarketDataQualityReport;
  status: Mt5ImportAcceptanceState;
  sourceLabel?: string | null;
  originalFileName?: string | null;
}

/**
 * Persists one import: metadata row first, then R2 candle chunks keyed by
 * that row's own id. If the R2 write fails, the metadata row is removed
 * (best-effort cleanup) rather than left pointing at data that was never
 * actually written — this stage does not attempt true cross-store
 * transactional atomicity (Postgres + R2 have no shared transaction), but
 * never leaves a "successful" import with silently missing chunks.
 *
 * §22 — a new import is ALWAYS its own row; overlapping an existing
 * import for the same (user, symbol, timeframe) never merges or deletes
 * the earlier one. See `mt5-import-provider.ts` for the deterministic
 * "most recently created import wins for an overlapping instant" read-time
 * rule this enables, with both imports' provenance fully preserved.
 */
export async function createMt5Import(userId: string, input: CreateMt5ImportInput): Promise<MarketDataImportSummaryDTO> {
  if (input.status === "INVALID" || input.status === "NEEDS_USER_INPUT") {
    throw new Error(`Cannot persist an import in state ${input.status}.`);
  }
  if (input.candles.length === 0) {
    throw new Error("Cannot persist an import with zero candles.");
  }

  const row = await prisma.marketDataImport.create({
    data: {
      userId,
      sourceType: "MT5",
      sourceLabel: input.sourceLabel ?? null,
      sourceSymbol: input.sourceSymbol,
      canonicalSymbol: input.canonicalSymbol,
      nativeTimeframe: input.nativeTimeframe,
      timeConventionJson: input.timeConvention as object,
      rangeFrom: new Date(input.candles[0].timestamp),
      rangeTo: new Date(input.candles[input.candles.length - 1].timestamp),
      originalFileName: input.originalFileName ?? null,
      qualitySummaryJson: input.quality as unknown as object,
      status: input.status,
      candleCount: input.candles.length,
    },
  });

  try {
    await writeCandleChunks(userId, row.id, input.candles);
  } catch (error) {
    await prisma.marketDataImport.delete({ where: { id: row.id } }).catch(() => {});
    throw error;
  }

  return toDTO(row);
}

export async function listMt5Imports(userId: string): Promise<MarketDataImportSummaryDTO[]> {
  const rows = await prisma.marketDataImport.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toDTO);
}

/** Ownership-scoped by construction — a row belonging to another user
 *  simply doesn't match this `where`, so this returns `null` exactly as if
 *  the id didn't exist at all (never a distinguishable "found but not
 *  yours" response that would leak existence). */
export async function getMt5Import(userId: string, importId: string): Promise<MarketDataImportSummaryDTO | null> {
  const row = await prisma.marketDataImport.findFirst({ where: { id: importId, userId } });
  return row ? toDTO(row) : null;
}

export async function deleteMt5Import(userId: string, importId: string): Promise<{ success: boolean }> {
  const row = await prisma.marketDataImport.findFirst({ where: { id: importId, userId }, select: { id: true } });
  if (!row) return { success: false };
  await deleteImportChunks(userId, row.id);
  await prisma.marketDataImport.delete({ where: { id: row.id } });
  return { success: true };
}

/** All of a user's imports covering `canonicalSymbol`/`nativeTimeframe`
 *  that overlap `[from, to]`, newest first — the exact set + ordering
 *  `Mt5ImportedHistoricalMarketDataProvider` needs to apply the §22
 *  "newest import wins on overlap" rule. */
export async function findOverlappingMt5Imports(userId: string, canonicalSymbol: string, nativeTimeframe: Timeframe, from: number, to: number): Promise<MarketDataImportSummaryDTO[]> {
  const rows = await prisma.marketDataImport.findMany({
    where: {
      userId,
      canonicalSymbol,
      nativeTimeframe,
      status: { in: ["READY", "READY_WITH_WARNINGS"] },
      rangeFrom: { lte: new Date(to) },
      rangeTo: { gte: new Date(from) },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

/** Reads candles for one import, bounded to `[from, to]` — thin wrapper
 *  kept here (rather than calling `readCandleChunksInRange` directly from
 *  the provider) so the provider never needs to know the R2 key scheme. */
export async function readMt5ImportCandles(userId: string, importId: string, from: number, to: number): Promise<Candle[]> {
  return readCandleChunksInRange(userId, importId, from, to);
}
