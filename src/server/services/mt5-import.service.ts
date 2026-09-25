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
import { buildMt5ImportPreview } from "@/domain/mt5-import/mt5-import-preview";
import { decodeMt5UploadBytes, parseMt5HistoricalData } from "@/domain/mt5-import/mt5-parser";
import { normalizeMt5Candles } from "@/domain/mt5-import/mt5-normalize";
import { MAX_MT5_IMPORT_FILE_SIZE_BYTES } from "@/lib/validation/mt5-import";
import type { Candle } from "@/domain/market-data/candle";
import type { MarketDataQualityReport } from "@/domain/market-data/quality-analysis";
import type { Timeframe } from "@/domain/market-data/timeframe";
import type { Mt5ImportAcceptanceState, Mt5ImportPreview, TimeConvention } from "@/domain/mt5-import/types";
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

// ── Upload workflow (Edge Review Replay Data Source §8-13) ─────────────────
// Decode -> detect -> parse -> normalize -> preview, reusing the EXACT same
// pure domain functions Stage 21.3A already built and tested
// (`mt5-parser.ts`/`mt5-normalize.ts`/`mt5-import-preview.ts`) — this file
// is only the I/O boundary (base64 decode, size guard, and — for confirm —
// persistence via `createMt5Import` above), never a second parser.

function decodeMt5Upload(fileContentBase64: string): Uint8Array {
  const buf = Buffer.from(fileContentBase64, "base64");
  if (buf.byteLength === 0) throw new Error("File is malformed or could not be read.");
  if (buf.byteLength > MAX_MT5_IMPORT_FILE_SIZE_BYTES) throw new Error("File exceeds the upload limit.");
  return new Uint8Array(buf);
}

export interface PreviewMt5UploadParams {
  fileContentBase64: string;
  sourceSymbol: string | null;
  timeframeHint: string | null;
  timeConvention: TimeConvention | null;
}

/** Read-only — never persists anything. Mirrors §9/§10/§11: NEEDS_USER_INPUT
 *  asks for exactly what's missing, INVALID surfaces the real reason, and
 *  READY/READY_WITH_WARNINGS carry everything the confirm step needs. */
export function previewMt5Upload(params: PreviewMt5UploadParams): Mt5ImportPreview {
  const bytes = decodeMt5Upload(params.fileContentBase64);
  const text = decodeMt5UploadBytes(bytes);
  return buildMt5ImportPreview({
    text,
    sourceSymbol: params.sourceSymbol,
    timeframeHint: params.timeframeHint,
    timeConvention: params.timeConvention,
  });
}

export interface ConfirmMt5UploadParams {
  fileContentBase64: string;
  fileName: string;
  sourceSymbol: string | null;
  timeframeHint: string | null;
  timeConvention: TimeConvention | null;
  /** The symbol the trader confirmed (or that the preview already
   *  resolved) — checked against the file's OWN resolution rather than
   *  trusted blindly, so confirm never persists a different symbol than
   *  what the preview showed. */
  canonicalSymbol: string;
  /** §13 — true once the trader has seen the overlap warning and chose to
   *  proceed anyway ("Import Anyway"). Omitted/false: an overlap blocks
   *  with the overlapping datasets instead of silently duplicating
   *  coverage. */
  allowOverlap?: boolean;
}

export type ConfirmMt5UploadResult =
  | { status: "IMPORTED"; import: MarketDataImportSummaryDTO }
  | { status: "OVERLAP_CONFIRMATION_REQUIRED"; overlapping: MarketDataImportSummaryDTO[] }
  | { status: "ERROR"; error: string };

/**
 * Re-runs the same detect/parse/normalize pipeline the preview used (on the
 * SAME uploaded bytes) to obtain real `Candle[]` for persistence — the pure
 * preview builder deliberately never returns candle data itself (see its
 * own doc comment), so this is the one place that materializes them, right
 * before `createMt5Import` persists. Never accepts a state the preview
 * itself would refuse (INVALID/NEEDS_USER_INPUT) — mirrors
 * `createMt5Import`'s own guard, but with a trader-facing reason instead of
 * a thrown error.
 */
export async function confirmMt5Upload(userId: string, params: ConfirmMt5UploadParams): Promise<ConfirmMt5UploadResult> {
  let bytes: Uint8Array;
  try {
    bytes = decodeMt5Upload(params.fileContentBase64);
  } catch (error) {
    return { status: "ERROR", error: error instanceof Error ? error.message : "Couldn't read that file." };
  }
  const text = decodeMt5UploadBytes(bytes);

  const preview = buildMt5ImportPreview({
    text,
    sourceSymbol: params.sourceSymbol,
    timeframeHint: params.timeframeHint,
    timeConvention: params.timeConvention,
  });
  if (preview.state === "INVALID") return { status: "ERROR", error: preview.issues[0] ?? "This file can't be imported." };
  if (preview.state === "NEEDS_USER_INPUT") {
    return { status: "ERROR", error: preview.issues[0] ?? "More information is needed before this file can be imported." };
  }
  if (!preview.symbol.canonicalSymbol || preview.symbol.canonicalSymbol !== params.canonicalSymbol) {
    return { status: "ERROR", error: "The confirmed symbol doesn't match this file's resolved symbol." };
  }
  if (!preview.nativeTimeframe || !preview.timeConvention || !preview.range || !preview.quality || !preview.detection.ok) {
    return { status: "ERROR", error: "This file could not be fully processed." };
  }

  const parsed = parseMt5HistoricalData(text, preview.detection);
  const normalized = normalizeMt5Candles(parsed.rows, preview.timeConvention);
  if (normalized.candles.length === 0) return { status: "ERROR", error: "No valid candles could be produced from this file." };

  if (!params.allowOverlap) {
    const overlapping = await findOverlappingMt5Imports(
      userId,
      preview.symbol.canonicalSymbol,
      preview.nativeTimeframe,
      normalized.candles[0].timestamp,
      normalized.candles[normalized.candles.length - 1].timestamp,
    );
    if (overlapping.length > 0) return { status: "OVERLAP_CONFIRMATION_REQUIRED", overlapping };
  }

  const created = await createMt5Import(userId, {
    sourceSymbol: preview.symbol.sourceSymbol,
    canonicalSymbol: preview.symbol.canonicalSymbol,
    nativeTimeframe: preview.nativeTimeframe,
    timeConvention: preview.timeConvention,
    candles: normalized.candles,
    quality: preview.quality,
    status: preview.state,
    sourceLabel: "MT5 Export",
    originalFileName: params.fileName,
  });
  return { status: "IMPORTED", import: created };
}
