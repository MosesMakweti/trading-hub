"use server";

/**
 * Edge Review Replay Data Source — server actions for the MT5 historical-
 * CANDLE import wizard and the explicit dataset/provider selection that
 * establishes Replay's market-data provenance (§14-16). Thin per this
 * codebase's convention: auth, Zod parse, delegate to the service layer,
 * never business logic here.
 */
import { requireUser } from "@/server/guards";
import * as mt5ImportService from "@/server/services/mt5-import.service";
import * as replayReviewService from "@/server/services/replay-review.service";
import {
  confirmMt5ImportSchema,
  listMt5DataSourceOptionsSchema,
  previewMt5ImportSchema,
  resetMarketDataSourceSchema,
  selectMt5DataSourceSchema,
} from "@/lib/validation/mt5-import";
import type { Mt5ImportPreview } from "@/domain/mt5-import/types";
import type { ConfirmMt5UploadResult } from "@/server/services/mt5-import.service";
import type { Mt5DataSourceOptionDTO } from "@/server/services/replay-review.service";

type ActionResult = { success: true } | { success: false; error: string };

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/** Read-only — parses/validates the upload without persisting anything. */
export async function previewMt5ImportAction(
  input: unknown,
): Promise<{ success: true; preview: Mt5ImportPreview } | { success: false; error: string }> {
  await requireUser();
  const parsed = previewMt5ImportSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    const preview = mt5ImportService.previewMt5Upload({
      fileContentBase64: parsed.data.fileContentBase64,
      sourceSymbol: parsed.data.sourceSymbol ?? null,
      timeframeHint: parsed.data.timeframeHint ?? null,
      timeConvention: parsed.data.timeConvention ?? null,
    });
    return { success: true, preview };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Couldn't read that file." };
  }
}

/** Persists the import once the trader confirms. May come back asking for
 *  overlap confirmation instead of importing (§13) — the wizard re-calls
 *  this with `allowOverlap: true` once the trader accepts. */
export async function confirmMt5ImportAction(input: unknown): Promise<{ success: true; result: ConfirmMt5UploadResult } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = confirmMt5ImportSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  try {
    const result = await mt5ImportService.confirmMt5Upload(user.id, {
      fileContentBase64: parsed.data.fileContentBase64,
      fileName: parsed.data.fileName,
      sourceSymbol: parsed.data.sourceSymbol ?? null,
      timeframeHint: parsed.data.timeframeHint ?? null,
      timeConvention: parsed.data.timeConvention ?? null,
      canonicalSymbol: parsed.data.canonicalSymbol,
      allowOverlap: parsed.data.allowOverlap,
    });
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to import the file." };
  }
}

/** Every one of the trader's MT5 imports for this replay session's current
 *  asset/timeframe, annotated with compatibility (§5/§6/§18). */
export async function listMt5DataSourceOptionsAction(
  input: unknown,
): Promise<{ success: true; options: Mt5DataSourceOptionDTO[] } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = listMt5DataSourceOptionsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const result = await replayReviewService.listMt5DataSourceOptions(user.id, parsed.data.sessionId, parsed.data.canonicalSymbol, parsed.data.nativeTimeframe);
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, options: result.options };
}

/** Explicitly establishes this session's Replay provenance for one asset as
 *  MT5 Imported Data + one exact `MarketDataImport` (§14/§15 — the user's
 *  own top priority for this feature). */
export async function selectMt5DataSourceAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = selectMt5DataSourceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const result = await replayReviewService.selectMt5DataSource(
    user.id,
    parsed.data.sessionId,
    parsed.data.canonicalSymbol,
    parsed.data.importId,
    parsed.data.nativeTimeframe,
  );
  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}

/** Reverts an unconsumed explicit selection back to automatic resolution
 *  ("Traditorium Historical Data"). */
export async function resetMarketDataSourceAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = resetMarketDataSourceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const result = await replayReviewService.resetMarketDataSourceSelection(user.id, parsed.data.sessionId, parsed.data.canonicalSymbol);
  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}
