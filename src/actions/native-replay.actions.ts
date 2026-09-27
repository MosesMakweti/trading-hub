"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  advanceReplaySchema,
  createImportUploadSchema,
  datasetPinSchema,
  datasetUnpinSchema,
  processImportUploadSchema,
  replayCandlesSchema,
  saveDrawingSchema,
  drawingRefSchema,
  listDrawingsSchema,
  linkDrawingSchema,
  replayClockSchema,
} from "@/lib/validation/native-replay";
import { BacktestDateOutOfRangeError, BacktestRunNotFoundError } from "@/server/services/backtest-run.service";
import * as datasetService from "@/server/services/native-replay/historical-dataset.service";
import * as uploadService from "@/server/services/native-replay/historical-upload.service";
import * as pinService from "@/server/services/native-replay/backtest-dataset-pin.service";
import * as replayService from "@/server/services/native-replay/backtest-replay.service";
import * as drawingService from "@/server/services/native-replay/chart-drawing.service";
import type { ChartDrawing } from "@/domain/native-replay/drawings/model";
import { CandleRangeTooLargeError } from "@/server/services/native-replay/historical-candles.service";
import type { HistoricalImportReport } from "@/domain/native-replay/m1-dataset";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

/** Errors written for the trader pass through verbatim; anything else is logged and hidden. */
function fail(error: unknown, fallback: string): Fail {
  if (
    error instanceof replayService.ReplayError ||
    error instanceof replayService.ReplayNotFoundError ||
    error instanceof pinService.DatasetPinError ||
    error instanceof datasetService.HistoricalDatasetNotFoundError ||
    error instanceof datasetService.HistoricalDatasetInUseError ||
    error instanceof uploadService.ImportUploadError ||
    error instanceof uploadService.ImportUploadNotFoundError ||
    error instanceof BacktestRunNotFoundError ||
    error instanceof BacktestDateOutOfRangeError ||
    error instanceof CandleRangeTooLargeError ||
    error instanceof drawingService.DrawingError ||
    error instanceof drawingService.DrawingNotFoundError
  ) {
    return { success: false, error: error.message };
  }
  console.error("[native-replay.actions]", error);
  return { success: false, error: fallback };
}

function invalid(error: { issues: { message: string }[] }): Fail {
  return { success: false, error: error.issues[0]?.message ?? "Invalid input." };
}

// ── Datasets & direct-to-R2 upload ─────────────────────────────────────────

export async function createImportUploadAction(input: unknown): Promise<Ok<uploadService.CreatedImportUpload> | Fail> {
  const user = await requireUser();
  const parsed = createImportUploadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, ...(await uploadService.createImportUpload(user.id, parsed.data)) };
  } catch (error) {
    return fail(error, "Couldn't start the upload.");
  }
}

export async function previewImportUploadAction(input: unknown): Promise<Ok<{ report: HistoricalImportReport }> | Fail> {
  const user = await requireUser();
  const parsed = processImportUploadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, report: await uploadService.previewImportUpload(user.id, parsed.data.uploadId, parsed.data.symbol) };
  } catch (error) {
    return fail(error, "Couldn't validate the file.");
  }
}

export async function completeImportUploadAction(
  input: unknown,
): Promise<Ok<{ dataset: datasetService.HistoricalDatasetDTO }> | (Fail & { report?: HistoricalImportReport })> {
  const user = await requireUser();
  const parsed = processImportUploadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await uploadService.completeImportUpload(user.id, parsed.data.uploadId, parsed.data);
    if (!result.ok) return { success: false, error: result.error, report: result.report };
    revalidatePath("/backtesting/data");
    return { success: true, dataset: result.dataset };
  } catch (error) {
    return fail(error, "The import failed — nothing was made available. Please try again.");
  }
}

export async function cancelImportUploadAction(uploadId: string): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  try {
    await uploadService.cancelImportUpload(user.id, String(uploadId));
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't cancel the upload.");
  }
}

export async function deleteHistoricalDatasetAction(datasetId: string): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  try {
    await datasetService.deleteHistoricalDataset(user.id, String(datasetId));
  } catch (error) {
    return fail(error, "Couldn't delete the dataset.");
  }
  revalidatePath("/backtesting/data");
  return { success: true };
}

// ── Run ↔ dataset pins ─────────────────────────────────────────────────────

export async function attachDatasetToRunAction(input: unknown): Promise<Ok<{ coveredDays: number }> | Fail> {
  const user = await requireUser();
  const parsed = datasetPinSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const pin = await pinService.attachDatasetToRun(user.id, parsed.data);
    revalidatePath("/backtesting/data");
    revalidatePath(`/backtesting/${parsed.data.runId}`, "layout");
    return { success: true, coveredDays: pin.coveredDays };
  } catch (error) {
    return fail(error, "Couldn't attach the dataset.");
  }
}

export async function detachDatasetFromRunAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = datasetUnpinSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await pinService.detachDatasetFromRun(user.id, parsed.data);
    revalidatePath("/backtesting/data");
    revalidatePath(`/backtesting/${parsed.data.runId}`, "layout");
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't detach the dataset.");
  }
}

// ── Replay clock ───────────────────────────────────────────────────────────
// No revalidatePath here: replay moves many times a minute and only the
// replay controls re-render from the returned state.

export async function getReplayStateAction(input: unknown): Promise<Ok<{ state: replayService.ReplayStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = replayClockSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, state: await replayService.getReplayState(user.id, parsed.data) };
  } catch (error) {
    return fail(error, "Couldn't load the replay.");
  }
}

export async function initializeReplayAction(input: unknown): Promise<Ok<{ state: replayService.ReplayStateDTO }> | Fail> {
  const user = await requireUser();
  const parsed = replayClockSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, state: await replayService.initializeReplay(user.id, parsed.data) };
  } catch (error) {
    return fail(error, "Couldn't start the replay.");
  }
}

export async function advanceReplayAction(input: unknown): Promise<Ok<{ result: replayService.AdvanceResult }> | Fail> {
  const user = await requireUser();
  const parsed = advanceReplaySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { command, commandId, viewAsset, ...ref } = parsed.data;
  try {
    return { success: true, result: await replayService.advanceReplay(user.id, ref, command, commandId, viewAsset) };
  } catch (error) {
    return fail(error, "Couldn't advance the replay.");
  }
}

export async function getReplayCandlesAction(input: unknown): Promise<Ok<{ candles: replayService.ReplayCandlesResult }> | Fail> {
  const user = await requireUser();
  const parsed = replayCandlesSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { timeframe, limit, to, ...ref } = parsed.data;
  try {
    return { success: true, candles: await replayService.getReplayCandles(user.id, ref, { timeframe, limit, to }) };
  } catch (error) {
    return fail(error, "Couldn't load candles.");
  }
}

// ── Chart drawings (no revalidation: the chart keeps its own state) ────────

export async function listDrawingsAction(input: unknown): Promise<Ok<{ drawings: ChartDrawing[] }> | Fail> {
  const user = await requireUser();
  const parsed = listDrawingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, drawings: await drawingService.listDrawings(user.id, parsed.data.runId, parsed.data.assetSymbol) };
  } catch (error) {
    return fail(error, "Couldn't load drawings.");
  }
}

export async function saveDrawingAction(input: unknown): Promise<Ok<{ drawing: ChartDrawing }> | Fail> {
  const user = await requireUser();
  const parsed = saveDrawingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    return { success: true, drawing: await drawingService.saveDrawing(user.id, parsed.data.runId, parsed.data.drawing) };
  } catch (error) {
    return fail(error, "Couldn't save the drawing.");
  }
}

export async function deleteDrawingAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = drawingRefSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await drawingService.deleteDrawing(user.id, parsed.data.runId, parsed.data.assetSymbol, parsed.data.drawingId);
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't delete the drawing.");
  }
}

export async function linkDrawingToTradeAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = linkDrawingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await drawingService.linkDrawingToTrade(user.id, parsed.data.runId, parsed.data.assetSymbol, parsed.data.drawingId, parsed.data.tradeId);
    return { success: true };
  } catch (error) {
    return fail(error, "Couldn't link the drawing.");
  }
}
