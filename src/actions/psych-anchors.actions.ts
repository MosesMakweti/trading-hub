"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { psychAnchorSchema, reorderSchema } from "@/lib/validation/trading-plan";
import * as psychAnchorsService from "@/server/services/psych-anchors.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createPsychAnchor(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = psychAnchorSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await psychAnchorsService.createPsychAnchor(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updatePsychAnchor(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = psychAnchorSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await psychAnchorsService.updatePsychAnchor(user.id, id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function archivePsychAnchor(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await psychAnchorsService.archivePsychAnchor(user.id, id);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function reorderPsychAnchors(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await psychAnchorsService.reorderPsychAnchors(user.id, parsed.data.orderedIds);
  revalidatePath("/settings/plan");
  return { success: true };
}
