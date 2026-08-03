"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  strategyCreateSchema,
  strategyRenameSchema,
  strategySettingsSchema,
  strategyStatusSchema,
} from "@/lib/validation/strategies";
import * as strategiesService from "@/server/services/strategies.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createStrategy(input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = strategyCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const strategy = await strategiesService.createStrategy(user.id, parsed.data);
  revalidatePath("/strategy-lab");
  return { success: true, id: strategy.id };
}

export async function updateStrategySettings(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = strategySettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await strategiesService.updateStrategySettings(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidatePath("/strategy-lab");
  revalidatePath(`/strategy-lab/${id}`);
  return { success: true };
}

export async function renameStrategy(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = strategyRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await strategiesService.renameStrategy(user.id, id, parsed.data.name);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to rename.") };
  }
  revalidatePath("/strategy-lab");
  revalidatePath(`/strategy-lab/${id}`);
  return { success: true };
}

export async function setStrategyStatus(id: string, status: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = strategyStatusSchema.safeParse(status);
  if (!parsed.success) return { success: false, error: "Invalid status." };

  try {
    await strategiesService.setStrategyStatus(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update status.") };
  }
  revalidatePath("/strategy-lab");
  revalidatePath(`/strategy-lab/${id}`);
  return { success: true };
}

export async function deleteStrategy(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await strategiesService.deleteStrategy(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete.") };
  }
  revalidatePath("/strategy-lab");
  return { success: true };
}

export async function publishStrategyVersion(id: string, note: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const trimmed = typeof note === "string" ? note.trim().slice(0, 500) : null;
  try {
    await strategiesService.publishStrategyVersion(user.id, id, trimmed || null);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to publish version.") };
  }
  revalidatePath("/strategy-lab");
  revalidatePath(`/strategy-lab/${id}`);
  return { success: true };
}

export async function duplicateStrategy(id: string): Promise<CreateResult> {
  const user = await requireUser();
  try {
    const copy = await strategiesService.duplicateStrategy(user.id, id);
    revalidatePath("/strategy-lab");
    return { success: true, id: copy.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to duplicate.") };
  }
}
