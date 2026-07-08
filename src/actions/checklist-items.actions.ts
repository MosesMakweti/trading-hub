"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { checklistItemSchema, reorderSchema } from "@/lib/validation/trading-plan";
import * as checklistItemsService from "@/server/services/checklist-items.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createChecklistItem(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await checklistItemsService.createChecklistItem(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateChecklistItem(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await checklistItemsService.updateChecklistItem(user.id, id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function archiveChecklistItem(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await checklistItemsService.archiveChecklistItem(user.id, id);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function reorderChecklistItems(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await checklistItemsService.reorderChecklistItems(user.id, parsed.data.orderedIds);
  revalidatePath("/settings/plan");
  return { success: true };
}
