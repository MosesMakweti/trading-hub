"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { entryModelSchema, reorderSchema } from "@/lib/validation/trading-plan";
import * as entryModelsService from "@/server/services/entry-models.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createEntryModel(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = entryModelSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await entryModelsService.createEntryModel(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateEntryModel(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = entryModelSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await entryModelsService.updateEntryModel(user.id, id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function archiveEntryModel(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await entryModelsService.archiveEntryModel(user.id, id);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function reorderEntryModels(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await entryModelsService.reorderEntryModels(user.id, parsed.data.orderedIds);
  revalidatePath("/settings/plan");
  return { success: true };
}
