"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  frameworkReorderSchema,
  frameworkStepCreateSchema,
  frameworkStepUpdateSchema,
} from "@/lib/validation/framework";
import * as frameworkService from "@/server/services/framework.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createFrameworkStep(
  strategyId: string,
  input: unknown,
): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = frameworkStepCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const step = await frameworkService.createFrameworkStep(user.id, strategyId, parsed.data.title);
    revalidatePath(`/strategy-lab/${strategyId}`);
    return { success: true, id: step.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add step.") };
  }
}

export async function updateFrameworkStep(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = frameworkStepUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await frameworkService.updateFrameworkStep(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function archiveFrameworkStep(
  strategyId: string,
  id: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await frameworkService.archiveFrameworkStep(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete step.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function reorderFrameworkSteps(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = frameworkReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  try {
    await frameworkService.reorderFrameworkSteps(
      user.id,
      parsed.data.strategyId,
      parsed.data.orderedIds,
    );
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  revalidatePath(`/strategy-lab/${parsed.data.strategyId}`);
  return { success: true };
}
