"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import * as propFirmsService from "@/server/services/prop-firms.service";
import {
  advanceStageSchema,
  copyStageRulesSchema,
  createMilestoneSchema,
  createPayoutSchema,
  createPropFirmAccountSchema,
  createStageRuleSchema,
  createUserPropFirmSchema,
  reorderPriorityFirmsSchema,
  reorderStageRulesSchema,
  updatePayoutSchema,
  updatePropFirmAccountSchema,
  updateUserPropFirmSchema,
} from "@/lib/validation/prop-firms";

type ActionResult = { success: true } | { success: false; error: string };
type AdvanceStageResult =
  | { success: true; milestoneId: string; nextStageId: string | null }
  | { success: false; error: string };

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

export async function createUserPropFirmAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createUserPropFirmSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  await propFirmsService.createUserPropFirm(user.id, {
    ...parsed.data,
    customLogoUrl: parsed.data.customLogoUrl || undefined,
    customWebsite: parsed.data.customWebsite || undefined,
  });
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function updateUserPropFirmAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updateUserPropFirmSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.updateUserPropFirm(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Update failed." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function createPropFirmAccountAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createPropFirmAccountSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.createPropFirmAccount(user.id, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to create account." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function updatePropFirmAccountAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updatePropFirmAccountSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.updatePropFirmAccount(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Update failed." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function archivePropFirmAccountAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await propFirmsService.archivePropFirmAccount(user.id, id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to archive." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function advanceAccountStageAction(accountId: string, input: unknown): Promise<AdvanceStageResult> {
  const user = await requireUser();
  const parsed = advanceStageSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  let result;
  try {
    result = await propFirmsService.advanceAccountStage(user.id, accountId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to advance stage." };
  }
  revalidatePath("/prop-firms");
  return { success: true, milestoneId: result.milestoneId, nextStageId: result.next?.id ?? null };
}

export async function reactivatePropFirmAccountAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await propFirmsService.reactivatePropFirmAccount(user.id, id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reactivate." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function reorderPriorityFirmsAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderPriorityFirmsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  await propFirmsService.reorderPriorityFirms(user.id, parsed.data.orderedIds);
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function reorderStageRulesAction(stageId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderStageRulesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.reorderStageRules(user.id, stageId, parsed.data.orderedRuleIds);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reorder rules." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function copyStageRulesAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = copyStageRulesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.copyStageRules(user.id, parsed.data.fromStageId, parsed.data.toStageId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to copy rules." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function createStageRuleAction(stageId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createStageRuleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.createStageRule(user.id, stageId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to add rule." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function updateStageRuleAction(ruleId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createStageRuleSchema.partial().safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.updateStageRule(user.id, ruleId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update rule." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function createAccountMilestoneAction(accountId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createMilestoneSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.createAccountMilestone(user.id, accountId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to add milestone." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function createPayoutAction(accountId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createPayoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.createPayout(user.id, accountId, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to log payout." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}

export async function updatePayoutAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updatePayoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await propFirmsService.updatePayout(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Update failed." };
  }
  revalidatePath("/prop-firms");
  return { success: true };
}
