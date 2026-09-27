/**
 * Native Replay — large-file import through R2 (production path).
 *
 *   createImportUpload   → PENDING: server picks the object key and returns a
 *                          presigned PUT (exact size + text/csv signed, 15 min)
 *   browser PUTs the file straight to R2 (no application request carries it)
 *   previewImportUpload  → reads the object, validates, stores the report
 *                          (an INVALID file is refused: FAILED, object deleted)
 *   completeImportUpload → claims the upload (PENDING → PROCESSING, so a
 *                          double click can't import twice), re-validates, imports
 *                          → COMPLETED (dataset created) or FAILED; the source
 *                          object is deleted either way
 *   sweep                → uploads past `expiresAt` (abandoned, or a crashed
 *                          import) → object deleted, EXPIRED
 *
 * The canonical dataset is the durable copy; the source CSV is not kept (no
 * permanent duplicate storage — the validation report and file SHA-256 on the
 * dataset are the audit trail, and re-importing the original file reproduces
 * the same bars).
 */
import { randomUUID } from "node:crypto";

import type { HistoricalImportUpload, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  deleteImportObject,
  headImportObject,
  importObjectKey,
  IMPORT_CONTENT_TYPE,
  listStaleImportObjects,
  presignImportUpload,
  readImportObject,
} from "@/lib/historical-import-storage";
import type { HistoricalImportReport } from "@/domain/native-replay/m1-dataset";
import {
  HistoricalImportRejectedError,
  importHistoricalDataset,
  MAX_HISTORICAL_IMPORT_BYTES,
  previewHistoricalImport,
  type HistoricalDatasetDTO,
} from "@/server/services/native-replay/historical-dataset.service";

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** How long an uploaded-but-not-imported file may sit in R2. */
export const UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;

export class ImportUploadError extends Error {}
export class ImportUploadNotFoundError extends Error {
  constructor() {
    super("Upload not found.");
  }
}

export interface CreatedImportUpload {
  uploadId: string;
  uploadUrl: string;
  /** Headers the browser must send with the PUT (they are signed). */
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export async function createImportUpload(
  userId: string,
  input: { fileName: string; sizeBytes: number; symbol?: string | null },
): Promise<CreatedImportUpload> {
  await sweepExpiredImportUploads(userId);
  void sweepOrphanedImportObjects().catch((error) => console.error("[native-replay/upload] orphan sweep failed", error));
  const fileName = input.fileName.trim().split(/[\\/]/).pop()?.slice(0, 255) ?? "";
  // MT5 exports are often extensionless (XAUUSD.n_M1_…): the name is only a
  // hint — the content is validated strictly when the file is read back.
  if (!fileName) throw new ImportUploadError("Choose the MT5 Market Bars export file.");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new ImportUploadError("The file is empty.");
  if (input.sizeBytes > MAX_HISTORICAL_IMPORT_BYTES) {
    throw new ImportUploadError(`The file is larger than ${MAX_HISTORICAL_IMPORT_BYTES / 1024 / 1024}MB. Split the history into several exports.`);
  }
  const objectKey = importObjectKey(userId, randomUUID());
  const upload = await prisma.historicalImportUpload.create({
    data: {
      userId,
      objectKey,
      fileName,
      declaredBytes: input.sizeBytes,
      symbolOverride: input.symbol?.trim() || null,
      expiresAt: new Date(Date.now() + UPLOAD_RETENTION_MS),
    },
  });
  const uploadUrl = await presignImportUpload(objectKey, input.sizeBytes, UPLOAD_URL_TTL_SECONDS);
  return {
    uploadId: upload.id,
    uploadUrl,
    uploadHeaders: { "Content-Type": IMPORT_CONTENT_TYPE },
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

async function findOwnedUpload(userId: string, uploadId: string): Promise<HistoricalImportUpload> {
  const upload = await prisma.historicalImportUpload.findFirst({ where: { id: uploadId, userId } });
  if (!upload) throw new ImportUploadNotFoundError();
  return upload;
}

/** Reads the uploaded object, verifying it arrived with the declared size. */
async function readUploaded(upload: HistoricalImportUpload): Promise<Uint8Array> {
  const size = await headImportObject(upload.objectKey);
  if (size == null) throw new ImportUploadError("The file hasn't finished uploading.");
  if (size !== upload.declaredBytes || size > MAX_HISTORICAL_IMPORT_BYTES) throw new ImportUploadError("The uploaded file doesn't match what was announced.");
  return readImportObject(upload.objectKey);
}

async function removeObject(upload: HistoricalImportUpload): Promise<void> {
  try {
    await deleteImportObject(upload.objectKey);
  } catch (error) {
    // Not fatal: the row records the key; the sweep never resurrects it, and
    // a leftover object is only ever a temporary import source.
    console.error("[native-replay/upload] could not delete source object", upload.id, error);
  }
}

async function finish(upload: HistoricalImportUpload, data: Prisma.HistoricalImportUploadUpdateInput): Promise<void> {
  await prisma.historicalImportUpload.update({ where: { id: upload.id }, data });
  await removeObject(upload);
}

/** Validates the uploaded file (nothing imported). An INVALID file ends the upload. */
export async function previewImportUpload(userId: string, uploadId: string, symbol?: string | null): Promise<HistoricalImportReport> {
  const upload = await findOwnedUpload(userId, uploadId);
  if (upload.status !== "PENDING") throw new ImportUploadError("This upload has already been processed — upload the file again.");
  const symbolOverride = symbol?.trim() || upload.symbolOverride;
  const bytes = await readUploaded(upload);
  let report: HistoricalImportReport;
  try {
    report = await previewHistoricalImport(userId, { bytes, fileName: upload.fileName, symbolOverride });
  } catch (error) {
    if (error instanceof HistoricalImportRejectedError) report = error.report;
    else throw error;
  }
  if (report.state === "INVALID" && report.symbol.symbol != null) {
    await finish(upload, { status: "FAILED", report: report as unknown as Prisma.InputJsonValue, failureReason: report.errors[0]?.slice(0, 500) ?? null });
  } else {
    // A missing symbol is fixable without re-uploading — keep the upload open.
    await prisma.historicalImportUpload.update({ where: { id: upload.id }, data: { report: report as unknown as Prisma.InputJsonValue, symbolOverride } });
  }
  return report;
}

export type CompleteImportResult = { ok: true; dataset: HistoricalDatasetDTO } | { ok: false; report: HistoricalImportReport; error: string };

/** Imports the uploaded file. Runs at most once per upload. */
export async function completeImportUpload(userId: string, uploadId: string, input: { symbol?: string | null; utcOffsetMinutes?: number | null } = {}): Promise<CompleteImportResult> {
  const upload = await findOwnedUpload(userId, uploadId);
  const symbolOverride = input.symbol?.trim() || upload.symbolOverride;
  const claimed = await prisma.historicalImportUpload.updateMany({ where: { id: upload.id, status: "PENDING" }, data: { status: "PROCESSING", symbolOverride } });
  if (claimed.count === 0) throw new ImportUploadError("This upload has already been processed — upload the file again.");

  try {
    const bytes = await readUploaded(upload);
    const dataset = await importHistoricalDataset(userId, { bytes, fileName: upload.fileName, symbolOverride, utcOffsetMinutes: input.utcOffsetMinutes ?? null });
    await finish(upload, { status: "COMPLETED", datasetId: dataset.id, report: dataset.report as unknown as Prisma.InputJsonValue });
    return { ok: true, dataset };
  } catch (error) {
    if (error instanceof HistoricalImportRejectedError) {
      await finish(upload, { status: "FAILED", report: error.report as unknown as Prisma.InputJsonValue, failureReason: error.message.slice(0, 500) });
      return { ok: false, report: error.report, error: error.message };
    }
    await finish(upload, { status: "FAILED", failureReason: (error instanceof Error ? error.message : "Import failed.").slice(0, 500) });
    throw error;
  }
}

/** Abandons an upload the trader no longer wants. */
export async function cancelImportUpload(userId: string, uploadId: string): Promise<void> {
  const upload = await findOwnedUpload(userId, uploadId);
  if (upload.status === "PENDING") await finish(upload, { status: "EXPIRED" });
}

/**
 * Deletes the objects of uploads that were never imported (or whose import
 * crashed) once they pass `expiresAt`. Scoped to one user when given.
 */
export async function sweepExpiredImportUploads(userId?: string): Promise<number> {
  const stale = await prisma.historicalImportUpload.findMany({
    where: { ...(userId ? { userId } : {}), status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { lt: new Date() } },
    take: 100,
  });
  for (const upload of stale) {
    const marked = await prisma.historicalImportUpload.updateMany({ where: { id: upload.id, status: upload.status }, data: { status: "EXPIRED" } });
    if (marked.count === 1) await removeObject(upload);
  }
  return stale.length;
}

const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastOrphanSweep = 0;

/**
 * Deletes import objects no in-progress upload refers to, once they're past the
 * retention window — e.g. the rows were removed with their user, or an upload
 * row was lost. Runs at most hourly per server instance (piggy-backing on new
 * uploads); only ever touches the import prefix.
 */
export async function sweepOrphanedImportObjects(options: { force?: boolean } = {}): Promise<number> {
  if (!options.force && Date.now() - lastOrphanSweep < ORPHAN_SWEEP_INTERVAL_MS) return 0;
  lastOrphanSweep = Date.now();
  const stale = await listStaleImportObjects(new Date(Date.now() - UPLOAD_RETENTION_MS));
  if (stale.length === 0) return 0;
  const live = new Set(
    (await prisma.historicalImportUpload.findMany({ where: { objectKey: { in: stale }, status: { in: ["PENDING", "PROCESSING"] } }, select: { objectKey: true } })).map((u) => u.objectKey),
  );
  let deleted = 0;
  for (const key of stale) {
    if (live.has(key)) continue;
    await deleteImportObject(key);
    deleted += 1;
  }
  return deleted;
}
