"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope, runInRecordScope } from "@/server/workspace/action-scope";
import { dayEditableGuard } from "@/actions/day-guard";
import {
  dailyAssetAnalysisCreateSchema,
  dailyAssetAnalysisReorderSchema,
  dailyAssetAnalysisUpdateSchema,
  directionalEvidenceItemCreateSchema,
  directionalEvidenceItemUpdateSchema,
  directionalEvidenceReorderSchema,
} from "@/lib/validation/daily-asset-analysis";
import * as dailyAssetAnalysisService from "@/server/services/daily-asset-analysis.service";
import type { DirectionalEvidenceItemDTO } from "@/types/today";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };
type CreateEvidenceResult = { success: true; item: DirectionalEvidenceItemDTO } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Also the entry point for the watchlist convenience — clicking a watchlist
 *  asset calls this with that symbol and finds-or-creates its analysis. */
export async function createOrGetDailyAssetAnalysis(
  day: WorkspaceDayRef,
  input: unknown,
): Promise<CreateResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = dailyAssetAnalysisCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const analysis = await dailyAssetAnalysisService.createOrGetDailyAssetAnalysis(
        user.id,
        dateKey,
        parsed.data.assetSymbol,
      );
      revalidatePath("/today");
      return { success: true, id: analysis.id };
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to add asset analysis.") };
    }
  });
}

/**
 * Trade Idea Validation Shield (Stage 4 §10) — read-only lookup the trade
 * form calls as the trader types an asset symbol, to quietly surface the
 * day's own bias for context. Never blocks saving; no day-edit guard needed
 * since nothing is written.
 */
export async function getDailyAssetAnalysisBias(
  day: WorkspaceDayRef,
  assetSymbol: string,
): Promise<{ finalBias: "LONG" | "SHORT" | "NEUTRAL" | null }> {
  const user = await requireUser();
  const result = await runInDayScope(user.id, day, "read", async (dateKey) => ({
    finalBias: await dailyAssetAnalysisService.getFinalBiasForAsset(user.id, dateKey, assetSymbol),
  }));
  // A context read — an inaccessible day simply has no bias to suggest.
  return "finalBias" in result ? result : { finalBias: null };
}

export async function updateDailyAssetAnalysis(
  dateKey: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { analysis: id }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = dailyAssetAnalysisUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      await dailyAssetAnalysisService.updateDailyAssetAnalysis(user.id, id, parsed.data);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to save.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

export async function archiveDailyAssetAnalysis(dateKey: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { analysis: id }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      await dailyAssetAnalysisService.archiveDailyAssetAnalysis(user.id, id);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to delete asset analysis.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

export async function reorderDailyAssetAnalyses(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = dailyAssetAnalysisReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  const [firstId] = parsed.data.orderedIds;
  if (!firstId) return { success: true };

  // Record-tied: the analyses being reordered determine the environment.
  return runInRecordScope(user.id, { analysis: firstId }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, parsed.data.dateKey);
    if (blocked) return blocked;

    try {
      await dailyAssetAnalysisService.reorderDailyAssetAnalyses(
        user.id,
        parsed.data.dateKey,
        parsed.data.orderedIds,
      );
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to reorder.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

// ── Directional Evidence (Stage 11 §7-13) — fast add/toggle/remove, optional ─

export async function addDirectionalEvidenceItem(day: WorkspaceDayRef, input: unknown): Promise<CreateEvidenceResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = directionalEvidenceItemCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      const item = await dailyAssetAnalysisService.addDirectionalEvidenceItem(
        user.id,
        parsed.data.dailyAssetAnalysisId,
        parsed.data.label,
        parsed.data.direction,
      );
      revalidatePath("/today");
      return { success: true, item };
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to add evidence.") };
    }
  });
}

type SuggestEvidenceResult =
  | { success: true; items: DirectionalEvidenceItemDTO[]; directionalSourceCount: number }
  | { success: false; error: string };

/** Today V3 — "Suggest from strategy": unchecked candidates from the active strategy's confluences. */
export async function suggestDirectionalEvidence(
  day: WorkspaceDayRef,
  dailyAssetAnalysisId: string,
): Promise<SuggestEvidenceResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;
    if (typeof dailyAssetAnalysisId !== "string" || dailyAssetAnalysisId === "") {
      return { success: false, error: "Invalid asset analysis." };
    }

    try {
      const { created, directionalSourceCount } = await dailyAssetAnalysisService.suggestDirectionalEvidenceFromStrategy(
        user.id,
        dailyAssetAnalysisId,
      );
      revalidatePath("/today");
      return { success: true, items: created, directionalSourceCount };
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to suggest evidence.") };
    }
  });
}

export async function updateDirectionalEvidenceItem(
  dateKey: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { evidence: id }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = directionalEvidenceItemUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    try {
      await dailyAssetAnalysisService.updateDirectionalEvidenceItem(user.id, id, parsed.data);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to save.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

export async function deleteDirectionalEvidenceItem(dateKey: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { evidence: id }, "write", async () => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      await dailyAssetAnalysisService.deleteDirectionalEvidenceItem(user.id, id);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to remove evidence.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

export async function reorderDirectionalEvidenceItems(day: WorkspaceDayRef, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const parsed = directionalEvidenceReorderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid input." };

    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      await dailyAssetAnalysisService.reorderDirectionalEvidenceItems(
        user.id,
        parsed.data.dailyAssetAnalysisId,
        parsed.data.orderedIds,
      );
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to reorder.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}
