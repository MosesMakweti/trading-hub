"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  entryModelCreateSchema,
  entryModelReorderSchema,
  entryModelUpdateSchema,
} from "@/lib/validation/strategy-entry-models";
import * as entryModelsService from "@/server/services/strategy-entry-models.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createEntryModel(strategyId: string, input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = entryModelCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const model = await entryModelsService.createEntryModel(user.id, strategyId, parsed.data.name);
    revalidatePath(`/strategy-lab/${strategyId}`);
    return { success: true, id: model.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add entry model.") };
  }
}

export async function updateEntryModel(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = entryModelUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await entryModelsService.updateEntryModel(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function archiveEntryModel(strategyId: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await entryModelsService.archiveEntryModel(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete entry model.") };
  }
  revalidatePath(`/strategy-lab/${strategyId}`);
  return { success: true };
}

export async function reorderEntryModels(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = entryModelReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await entryModelsService.reorderEntryModels(
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
