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
import type { VersionRef } from "@/server/services/strategies.service";
import type { StrategyVersionDiff } from "@/types/strategies";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };
type CompareResult =
  | { success: true; diff: StrategyVersionDiff | null }
  | { success: false; error: string };

function toVersionRef(value: unknown): VersionRef | null {
  if (value === "current") return "current";
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

export async function compareStrategyVersions(
  id: string,
  base: unknown,
  target: unknown,
): Promise<CompareResult> {
  const user = await requireUser();
  const b = toVersionRef(base);
  const t = toVersionRef(target);
  if (!b || !t) return { success: false, error: "Invalid version selection." };
  try {
    const diff = await strategiesService.getStrategyVersionComparison(user.id, id, b, t);
    return { success: true, diff };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to compare versions.") };
  }
}

export async function restoreStrategyVersion(id: string, version: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const v = toVersionRef(version);
  if (!v || v === "current") return { success: false, error: "Invalid version." };
  try {
    const copy = await strategiesService.restoreStrategyVersionAsNewStrategy(user.id, id, v);
    revalidatePath("/strategy-lab");
    return { success: true, id: copy.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to restore version.") };
  }
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
