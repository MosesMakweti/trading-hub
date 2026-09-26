"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { runInRecordScope } from "@/server/workspace/action-scope";
import * as tradePlanService from "@/server/services/trade-plan.service";
import { toPlanWorkspaceDTO } from "@/server/services/trade-plan.mapper";
import {
  annotationUpsertSchema,
  attachScreenshotSchema,
  confirmPlanSchema,
  revisePlanSchema,
  useExistingScreenshotSchema,
} from "@/lib/validation/trade-plan";
import type { PlanWorkspaceDTO } from "@/types/trade-plan";

type ActionResult = { success: true } | { success: false; error: string };

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function revalidateTrade(dateKey: string, tradeId: string) {
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
}

export async function loadPlanWorkspaceAction(tradeId: string): Promise<{ success: true; data: PlanWorkspaceDTO } | { success: false; error: string }> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "read", async () => {
    try {
      const raw = await tradePlanService.getPlanWorkspace(user.id, tradeId);
      return { success: true, data: toPlanWorkspaceDTO(raw) };
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not load the trade plan.") };
    }
  });
}

export async function attachPlanScreenshotAction(dateKey: string, tradeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const parsed = attachScreenshotSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    try {
      await tradePlanService.attachPlanScreenshot(user.id, tradeId, parsed.data.mediaAssetId, parsed.data);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not attach the screenshot.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export async function pickExistingScreenshotAction(dateKey: string, tradeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const parsed = useExistingScreenshotSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    try {
      await tradePlanService.attachPlanScreenshotFromExisting(user.id, tradeId, parsed.data.mediaAttachmentId);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not use that image.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export async function removePlanScreenshotAction(dateKey: string, tradeId: string): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    try {
      await tradePlanService.removePlanScreenshot(user.id, tradeId);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not remove the screenshot.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export async function runRecognitionAction(dateKey: string, tradeId: string): Promise<{ success: true; status: string; error?: string } | { success: false; error: string }> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    try {
      const result = await tradePlanService.runRecognition(user.id, tradeId);
      revalidateTrade(dateKey, tradeId);
      return { success: true, status: result.status, error: result.error };
    } catch (error) {
      return { success: false, error: toMessage(error, "Recognition failed to start.") };
    }
  });
}

export async function upsertPlanAnnotationAction(dateKey: string, tradeId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const parsed = annotationUpsertSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    try {
      await tradePlanService.upsertAnnotation(user.id, tradeId, parsed.data);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not save the annotation.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export async function deletePlanAnnotationAction(dateKey: string, tradeId: string, annotationId: string): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    try {
      await tradePlanService.deleteAnnotation(user.id, tradeId, annotationId);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not remove the annotation.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export async function resetDetectedAnnotationsAction(dateKey: string, tradeId: string): Promise<ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    try {
      await tradePlanService.resetDetectedAnnotations(user.id, tradeId);
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not reset annotations.") };
    }
    revalidateTrade(dateKey, tradeId);
    return { success: true };
  });
}

export interface SavePlanActionResult {
  success: true;
  issues: { code: string; message: string; severity: "warning" | "error" }[];
}

export async function confirmPlanAction(dateKey: string, tradeId: string, input: unknown): Promise<SavePlanActionResult | ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const parsed = confirmPlanSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    try {
      const result = await tradePlanService.savePlan(user.id, tradeId, parsed.data);
      revalidateTrade(dateKey, tradeId);
      return { success: true, issues: result.issues };
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not save the plan.") };
    }
  });
}

export async function revisePlanAction(dateKey: string, tradeId: string, input: unknown): Promise<SavePlanActionResult | ActionResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const parsed = revisePlanSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    try {
      const result = await tradePlanService.savePlan(user.id, tradeId, parsed.data);
      revalidateTrade(dateKey, tradeId);
      return { success: true, issues: result.issues };
    } catch (error) {
      return { success: false, error: toMessage(error, "Could not save the revision.") };
    }
  });
}
