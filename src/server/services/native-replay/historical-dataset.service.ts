/**
 * Native Replay — historical dataset service (import, list, read, delete).
 *
 * Datasets are user-owned market data, not workspace (LIVE/BACKTEST) data:
 * they are not Backtesting root models and are never environment-scoped.
 * Every read goes through `userId` — another user's dataset is
 * indistinguishable from a missing one.
 *
 * IMPORT LIFECYCLE (atomic from the trader's point of view):
 *   1. Parse + validate the whole file in memory (nothing persisted). An
 *      INVALID report is refused with the report.
 *   2. Create the dataset IMPORTING.
 *   3. Insert the canonical bars in batches (not one giant transaction).
 *   4. Verify the stored row count, then flip to READY in one statement
 *      (a DB CHECK makes READY impossible without bars/range).
 *   5. Any failure → bars deleted, dataset FAILED with the reason.
 * Only READY datasets are ever served. An IMPORTING dataset left behind by a
 * crashed process is swept to FAILED (bars removed) once it is stale.
 */
import { createHash } from "node:crypto";

import { Prisma, type HistoricalDataset } from "@prisma/client";

import { prisma } from "@/server/db";
import { decodeBytes } from "@/domain/prop-firms/import/source/decode-bytes";
import { analyzeMt5M1Import } from "@/domain/native-replay/import-analysis";
import type { CanonicalM1Bars, HistoricalImportReport } from "@/domain/native-replay/m1-dataset";
import { formatWallClock } from "@/domain/native-replay/wall-clock";

/** An MT5 M1 line is ~45–65 bytes, so 150MB comfortably holds the 2M-bar
 *  row ceiling (`MAX_M1_ROWS`, ~5 years) while bounding what a single
 *  request can make the server decode and hold. */
export const MAX_HISTORICAL_IMPORT_BYTES = 150 * 1024 * 1024;
const INSERT_BATCH_ROWS = 20_000;
/** An IMPORTING dataset older than this was abandoned by a crashed import. */
const STALE_IMPORT_MS = 30 * 60 * 1000;
export const HISTORICAL_PARSER_VERSION = 1;

export class HistoricalDatasetNotFoundError extends Error {
  constructor() {
    super("Dataset not found.");
  }
}

export class HistoricalImportRejectedError extends Error {
  constructor(public readonly report: HistoricalImportReport) {
    super(report.errors[0] ?? "The file could not be imported.");
  }
}

export interface HistoricalDatasetDTO {
  id: string;
  source: "MT5";
  sourceSymbol: string;
  symbol: string;
  baseTimeframe: "M1";
  timeBasis: "BROKER_SERVER";
  utcOffsetMinutes: number | null;
  priceScale: number;
  firstBar: string | null; // wall clock, dataset time basis
  lastBar: string | null;
  firstBarMinute: number | null;
  lastBarMinute: number | null;
  barCount: number;
  hasTickVolume: boolean;
  hasRealVolume: boolean;
  hasSpread: boolean;
  originalFileName: string | null;
  fileSizeBytes: number | null;
  status: "IMPORTING" | "READY" | "FAILED";
  failureReason: string | null;
  createdAt: string;
  readyAt: string | null;
  report: HistoricalImportReport;
}

function toDTO(d: HistoricalDataset): HistoricalDatasetDTO {
  return {
    id: d.id,
    source: d.source,
    sourceSymbol: d.sourceSymbol,
    symbol: d.symbol,
    baseTimeframe: "M1",
    timeBasis: d.timeBasis,
    utcOffsetMinutes: d.utcOffsetMinutes,
    priceScale: d.priceScale,
    firstBar: d.firstBarMinute == null ? null : formatWallClock(d.firstBarMinute),
    lastBar: d.lastBarMinute == null ? null : formatWallClock(d.lastBarMinute),
    firstBarMinute: d.firstBarMinute,
    lastBarMinute: d.lastBarMinute,
    barCount: d.barCount,
    hasTickVolume: d.hasTickVolume,
    hasRealVolume: d.hasRealVolume,
    hasSpread: d.hasSpread,
    originalFileName: d.originalFileName,
    fileSizeBytes: d.fileSizeBytes,
    status: d.status,
    failureReason: d.failureReason,
    createdAt: d.createdAt.toISOString(),
    readyAt: d.readyAt?.toISOString() ?? null,
    report: d.validationReport as unknown as HistoricalImportReport,
  };
}

export interface HistoricalImportInput {
  bytes: Uint8Array;
  fileName: string | null;
  symbolOverride?: string | null;
  /** Only if the trader states it; never inferred. Informational only. */
  utcOffsetMinutes?: number | null;
}

function decode(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new HistoricalImportRejectedError(rejectedReport("The file is empty."));
  if (bytes.byteLength > MAX_HISTORICAL_IMPORT_BYTES) {
    throw new HistoricalImportRejectedError(rejectedReport(`The file is larger than ${MAX_HISTORICAL_IMPORT_BYTES / 1024 / 1024}MB. Split the history into several exports.`));
  }
  return decodeBytes(bytes).text;
}

/** An INVALID report for a file rejected before parsing (size, emptiness). */
function rejectedReport(reason: string): HistoricalImportReport {
  const { report } = analyzeMt5M1Import({ text: "", fileName: null });
  return { ...report, errors: [reason] };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withDuplicateFileWarning(userId: string, report: HistoricalImportReport, fileSha256: string): Promise<HistoricalImportReport> {
  const existing = await prisma.historicalDataset.findFirst({
    where: { userId, fileSha256, status: "READY" },
    select: { symbol: true, createdAt: true },
  });
  if (!existing) return report;
  const warning = `You already imported this exact file (${existing.symbol}, ${existing.createdAt.toISOString().slice(0, 10)}).`;
  return { ...report, warnings: [...report.warnings, warning], state: report.state === "VALID" ? "VALID_WITH_WARNINGS" : report.state };
}

/** Read-only: the full validation report, nothing persisted. */
export async function previewHistoricalImport(userId: string, input: HistoricalImportInput): Promise<HistoricalImportReport> {
  const text = decode(input.bytes);
  const { report } = analyzeMt5M1Import({ text, fileName: input.fileName, symbolOverride: input.symbolOverride });
  return withDuplicateFileWarning(userId, report, sha256(input.bytes));
}

async function insertBars(datasetSeq: number, bars: CanonicalM1Bars): Promise<void> {
  for (let start = 0; start < bars.count; start += INSERT_BATCH_ROWS) {
    const end = Math.min(start + INSERT_BATCH_ROWS, bars.count);
    const len = end - start;
    const col = (a: Int32Array | Float64Array | null) => (a ? Array.from(a.subarray(start, end)) : new Array<null>(len).fill(null));
    await prisma.$executeRaw`
      INSERT INTO "HistoricalBar" ("datasetSeq", "minute", "open", "high", "low", "close", "tickVolume", "realVolume", "spread")
      SELECT ${datasetSeq}, u.* FROM unnest(
        ${col(bars.minute)}::int4[], ${col(bars.open)}::int4[], ${col(bars.high)}::int4[], ${col(bars.low)}::int4[], ${col(bars.close)}::int4[],
        ${col(bars.tickVolume)}::int4[], ${col(bars.realVolume)}::float8[], ${col(bars.spread)}::int4[]
      ) AS u
    `;
  }
}

/**
 * Validates and persists an MT5 M1 export. Throws HistoricalImportRejectedError
 * (with the report) when the file is INVALID — nothing is written then.
 */
export async function importHistoricalDataset(userId: string, input: HistoricalImportInput): Promise<HistoricalDatasetDTO> {
  const text = decode(input.bytes);
  const analysis = analyzeMt5M1Import({ text, fileName: input.fileName, symbolOverride: input.symbolOverride });
  if (analysis.report.state === "INVALID" || !analysis.bars) throw new HistoricalImportRejectedError(analysis.report);
  const bars = analysis.bars;
  const fileSha256 = sha256(input.bytes);
  const report = await withDuplicateFileWarning(userId, analysis.report, fileSha256);
  const utcOffsetMinutes = input.utcOffsetMinutes ?? null;

  const dataset = await prisma.historicalDataset.create({
    data: {
      userId,
      source: "MT5",
      sourceSymbol: report.symbol.sourceSymbol!,
      symbol: report.symbol.symbol!,
      timeBasis: "BROKER_SERVER",
      utcOffsetMinutes,
      priceScale: report.priceScale!,
      hasTickVolume: report.volume.hasTickVolume,
      hasRealVolume: report.volume.hasRealVolume,
      hasSpread: report.volume.hasSpread,
      originalFileName: input.fileName?.slice(0, 255) ?? null,
      fileSizeBytes: input.bytes.byteLength,
      fileSha256,
      sourceFormat: report.format as unknown as Prisma.InputJsonValue,
      validationReport: { ...report, timeBasis: { basis: "BROKER_SERVER", utcOffsetMinutes } } as unknown as Prisma.InputJsonValue,
      parserVersion: HISTORICAL_PARSER_VERSION,
      status: "IMPORTING",
    },
  });

  try {
    await insertBars(dataset.seq, bars);
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM "HistoricalBar" WHERE "datasetSeq" = ${dataset.seq}
    `;
    if (count !== bars.count) throw new Error(`Stored ${count} of ${bars.count} bars.`);
    const ready = await prisma.historicalDataset.update({
      where: { id: dataset.id, status: "IMPORTING" },
      data: {
        status: "READY",
        readyAt: new Date(),
        barCount: bars.count,
        firstBarMinute: bars.minute[0],
        lastBarMinute: bars.minute[bars.count - 1],
      },
    });
    return toDTO(ready);
  } catch (error) {
    await failImport(dataset.seq, error instanceof Error ? error.message : "Import failed.");
    throw error;
  }
}

async function failImport(datasetSeq: number, reason: string): Promise<void> {
  await prisma.historicalBar.deleteMany({ where: { datasetSeq } });
  await prisma.historicalDataset.updateMany({
    where: { seq: datasetSeq, status: "IMPORTING" },
    data: { status: "FAILED", failureReason: reason.slice(0, 500), barCount: 0 },
  });
}

/** Marks IMPORTING datasets abandoned by a crashed import as FAILED. */
async function sweepStaleImports(userId: string): Promise<void> {
  const stale = await prisma.historicalDataset.findMany({
    where: { userId, status: "IMPORTING", createdAt: { lt: new Date(Date.now() - STALE_IMPORT_MS) } },
    select: { seq: true },
  });
  for (const d of stale) await failImport(d.seq, "The import was interrupted before it completed.");
}

export async function listHistoricalDatasets(userId: string): Promise<HistoricalDatasetDTO[]> {
  await sweepStaleImports(userId);
  const rows = await prisma.historicalDataset.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toDTO);
}

async function findOwned(userId: string, datasetId: string): Promise<HistoricalDataset> {
  const d = await prisma.historicalDataset.findFirst({ where: { id: datasetId, userId } });
  if (!d) throw new HistoricalDatasetNotFoundError();
  return d;
}

export async function getHistoricalDataset(userId: string, datasetId: string): Promise<HistoricalDatasetDTO> {
  return toDTO(await findOwned(userId, datasetId));
}

/** The dataset row for reading bars — READY only. */
export async function requireReadyDataset(userId: string, datasetId: string): Promise<HistoricalDataset> {
  const d = await findOwned(userId, datasetId);
  if (d.status !== "READY") throw new HistoricalDatasetNotFoundError();
  return d;
}

export class HistoricalDatasetInUseError extends Error {}

/**
 * A dataset pinned by a Backtest Run can't be deleted (the DB enforces it too:
 * the pin's foreign key). Tells the trader which runs use it.
 */
async function assertDatasetDeletable(dataset: HistoricalDataset): Promise<void> {
  const pins = await prisma.backtestRunDataset.findMany({
    where: { datasetId: dataset.id, userId: dataset.userId },
    select: { assetSymbol: true, backtestRun: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (pins.length === 0) return;
  const runs = [...new Set(pins.map((p) => `"${p.backtestRun.name}"`))];
  throw new HistoricalDatasetInUseError(
    `This historical dataset is used by ${runs.length} Backtest Run${runs.length === 1 ? "" : "s"} (${runs.join(", ")}). Remove those references or delete the runs first.`,
  );
}

/** Deletes a dataset; the DB trigger `HistoricalDataset_delete_bars` removes its bars. */
export async function deleteHistoricalDataset(userId: string, datasetId: string): Promise<void> {
  const dataset = await findOwned(userId, datasetId);
  await assertDatasetDeletable(dataset);
  await prisma.historicalDataset.delete({ where: { id: dataset.id } });
}
