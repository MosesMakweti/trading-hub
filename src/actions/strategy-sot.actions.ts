"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  checklistKindSchema,
  sotReorderSchema,
  strategyChecklistItemSchema,
  strategySessionSchema,
} from "@/lib/validation/strategy-sot";
import * as svc from "@/server/services/strategy-sot.service";

type Result = { success: true } | { success: false; error: string };
const rev = (strategyId: string) => revalidatePath(`/strategy-lab/${strategyId}`);
const invalid = (msg?: string): Result => ({ success: false, error: msg ?? "Invalid input." });

// ── Checklist items ──────────────────────────────────────────────────────────

export async function createStrategyChecklistItem(
  strategyId: string,
  kind: unknown,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const k = checklistKindSchema.safeParse(kind);
  const parsed = strategyChecklistItemSchema.safeParse(input);
  if (!k.success || !parsed.success) return invalid(parsed.success ? undefined : parsed.error.issues[0]?.message);
  await svc.createChecklistItem(user.id, strategyId, k.data, parsed.data);
  rev(strategyId);
  return { success: true };
}

export async function updateStrategyChecklistItem(
  id: string,
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = strategyChecklistItemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await svc.updateChecklistItem(user.id, id, parsed.data);
  rev(strategyId);
  return { success: true };
}

export async function deleteStrategyChecklistItem(id: string, strategyId: string): Promise<Result> {
  const user = await requireUser();
  await svc.deleteChecklistItem(user.id, id);
  rev(strategyId);
  return { success: true };
}

export async function reorderStrategyChecklistItems(
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = sotReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  await svc.reorderChecklistItems(user.id, parsed.data.orderedIds);
  rev(strategyId);
  return { success: true };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createStrategySession(strategyId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = strategySessionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await svc.createStrategySession(user.id, strategyId, parsed.data);
  rev(strategyId);
  return { success: true };
}

export async function updateStrategySession(
  id: string,
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = strategySessionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await svc.updateStrategySession(user.id, id, parsed.data);
  rev(strategyId);
  return { success: true };
}

export async function deleteStrategySession(id: string, strategyId: string): Promise<Result> {
  const user = await requireUser();
  await svc.deleteStrategySession(user.id, id);
  rev(strategyId);
  return { success: true };
}

export async function reorderStrategySessions(strategyId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = sotReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  await svc.reorderStrategySessions(user.id, parsed.data.orderedIds);
  rev(strategyId);
  return { success: true };
}
