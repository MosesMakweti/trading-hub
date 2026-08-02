"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  arsenalConceptCreateSchema,
  arsenalConceptUpdateSchema,
  arsenalReorderSchema,
} from "@/lib/validation/arsenal";
import * as arsenalService from "@/server/services/arsenal.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createArsenalConcept(
  strategyId: string,
  input: unknown,
): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = arsenalConceptCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const concept = await arsenalService.createArsenalConcept(user.id, strategyId, parsed.data.name);
    revalidatePath(`/strategy-lab/${strategyId}`);
    return { success: true, id: concept.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add concept.") };
  }
}

export async function updateArsenalConcept(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = arsenalConceptUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await arsenalService.updateArsenalConcept(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function archiveArsenalConcept(
  strategyId: string,
  id: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await arsenalService.archiveArsenalConcept(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete concept.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function reorderArsenalConcepts(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = arsenalReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  try {
    await arsenalService.reorderArsenalConcepts(
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
