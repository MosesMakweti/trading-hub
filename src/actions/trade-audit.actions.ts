"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  auditScopeSchema,
  commitmentFromAuditSchema,
  createExpectedTradeSchema,
  ensureOwnerSchema,
  saveAnnotationSchema,
  saveAssessmentSchema,
  saveDayAuditSchema,
  resolveCarriedCommitmentSchema,
  saveWeeklyAssessmentSchema,
  setAuditCommitmentStatusSchema,
  setDayStatusSchema,
  updateExpectedTradeSchema,
} from "@/lib/validation/trade-audit";
import * as audit from "@/server/services/trade-audit.service";
import { deleteMediaAttachment } from "@/server/services/media.service";
import type { MediaOwnerType } from "@prisma/client";

/**
 * Weekly Trade Audit server actions. Every action authenticates, validates
 * with zod, and lets the service resolve the audit from (user, week, scope)
 * — no client-supplied audit id or ownership field is ever trusted.
 */

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

function fail(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof audit.TradeAuditError) return { success: false, error: error.message };
  console.error(`[trade-audit] ${fallback}`, error);
  return { success: false, error: fallback };
}

function firstIssue(error: { issues: { message: string }[] }) {
  return { success: false as const, error: error.issues[0]?.message ?? "Invalid input." };
}

export async function saveDayAuditAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = saveDayAuditSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.saveDayAudit(user.id, parsed.data.scope, parsed.data.dateKey, parsed.data.patch);
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the day.");
  }
}

export async function setDayStatusAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = setDayStatusSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.setDayStatus(user.id, parsed.data.scope, parsed.data.dateKey, parsed.data.status);
    revalidatePath("/edge");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the day.");
  }
}

export async function saveTradeAssessmentAction(input: unknown): Promise<Result<{ assessmentId: string }>> {
  const user = await requireUser();
  const parsed = saveAssessmentSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const { assessmentId } = await audit.saveTradeAssessment(user.id, parsed.data.scope, parsed.data.tradeId, parsed.data.patch);
    return { success: true, assessmentId };
  } catch (e) {
    return fail(e, "Could not save the assessment.");
  }
}

export async function createExpectedTradeAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = createExpectedTradeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const { id } = await audit.createExpectedTrade(user.id, parsed.data.scope, parsed.data.dateKey, parsed.data.clientKey, parsed.data.data);
    revalidatePath("/edge");
    return { success: true, id };
  } catch (e) {
    return fail(e, "Could not add the missed trade.");
  }
}

export async function updateExpectedTradeAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = updateExpectedTradeSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.updateExpectedTrade(user.id, parsed.data.id, parsed.data.patch);
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the missed trade.");
  }
}

export async function deleteExpectedTradeAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return { success: false, error: "Invalid id." };
  try {
    await audit.deleteExpectedTrade(user.id, id);
    revalidatePath("/edge");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete the missed trade.");
  }
}

/** Resolves (idempotently creating) the review row an upload attaches to. */
export async function ensureUploadOwnerAction(input: unknown): Promise<Result<{ ownerType: MediaOwnerType; ownerId: string }>> {
  const user = await requireUser();
  const parsed = ensureOwnerSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const owner = await audit.ensureUploadOwner(user.id, parsed.data);
    return { success: true, ...owner };
  } catch (e) {
    return fail(e, "Could not prepare the upload.");
  }
}

export async function removeAuditImageAction(attachmentId: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof attachmentId !== "string" || attachmentId.length === 0 || attachmentId.length > 64) return { success: false, error: "Invalid id." };
  try {
    // deleteMediaAttachment is user-scoped and refuses finalized audit evidence.
    await deleteMediaAttachment(user.id, attachmentId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not remove the screenshot." };
  }
}

export async function saveAnnotationAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = saveAnnotationSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.saveAnnotation(user.id, parsed.data.scope, parsed.data.attachmentId, parsed.data.markers);
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the markers.");
  }
}

export async function saveWeeklyAssessmentAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = saveWeeklyAssessmentSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.saveWeeklyAssessment(user.id, parsed.data.scope, parsed.data.patch);
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the weekly assessment.");
  }
}

export async function finalizeAuditAction(scope: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = auditScopeSchema.safeParse(scope);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.finalizeAudit(user.id, parsed.data);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not finalize the week.");
  }
}

export async function reopenAuditAction(scope: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = auditScopeSchema.safeParse(scope);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.reopenAudit(user.id, parsed.data);
    revalidatePath("/edge");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not reopen the week.");
  }
}

export async function createCommitmentFromAuditAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = commitmentFromAuditSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const { scope, ...rest } = parsed.data;
    const { id } = await audit.createCommitmentFromAudit(user.id, scope, rest);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true, id };
  } catch (e) {
    return fail(e, "Could not create the commitment.");
  }
}

export async function resolveCarriedCommitmentAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = resolveCarriedCommitmentSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.resolveCarriedCommitment(user.id, parsed.data.scope, parsed.data.commitmentId, parsed.data.decision);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true };
  } catch (e) {
    if (e instanceof Error && !(e instanceof audit.TradeAuditError)) return { success: false, error: e.message };
    return fail(e, "Could not update the commitment.");
  }
}

export async function setAuditCommitmentStatusAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = setAuditCommitmentStatusSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await audit.setAuditCommitmentStatus(user.id, parsed.data.scope, parsed.data.commitmentId, parsed.data.status);
    revalidatePath("/edge");
    revalidatePath("/today");
    return { success: true };
  } catch (e) {
    if (e instanceof Error && !(e instanceof audit.TradeAuditError)) return { success: false, error: e.message };
    return fail(e, "Could not update the commitment.");
  }
}
