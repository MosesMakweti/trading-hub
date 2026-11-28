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
import { runStrategyAction, type ActionResult } from "@/server/services/strategy-errors";

// Every action returns a structured, readable result — never a thrown raw
// database error (audit #9).
type Result = ActionResult;
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
  const result = await runStrategyAction("Couldn't add this item.", () =>
    svc.createChecklistItem(user.id, strategyId, k.data, parsed.data),
  );
  if (result.success) rev(strategyId);
  return result;
}

export async function updateStrategyChecklistItem(
  id: string,
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = strategyChecklistItemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  const result = await runStrategyAction("Couldn't save this item.", () => svc.updateChecklistItem(user.id, id, parsed.data));
  if (result.success) rev(strategyId);
  return result;
}

export async function deleteStrategyChecklistItem(id: string, strategyId: string): Promise<Result> {
  const user = await requireUser();
  const result = await runStrategyAction("Couldn't delete this item.", () => svc.deleteChecklistItem(user.id, id));
  rev(strategyId);
  return result;
}

export async function reorderStrategyChecklistItems(
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = sotReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const result = await runStrategyAction("Couldn't reorder.", () => svc.reorderChecklistItems(user.id, parsed.data.orderedIds));
  rev(strategyId);
  return result;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createStrategySession(strategyId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = strategySessionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  const result = await runStrategyAction("Couldn't add this session.", () =>
    svc.createStrategySession(user.id, strategyId, parsed.data),
  );
  if (result.success) rev(strategyId);
  return result;
}

export async function updateStrategySession(
  id: string,
  strategyId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = strategySessionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  const result = await runStrategyAction("Couldn't save this session.", () => svc.updateStrategySession(user.id, id, parsed.data));
  if (result.success) rev(strategyId);
  return result;
}

export async function deleteStrategySession(id: string, strategyId: string): Promise<Result> {
  const user = await requireUser();
  const result = await runStrategyAction("Couldn't delete this session.", () => svc.deleteStrategySession(user.id, id));
  rev(strategyId);
  return result;
}

export async function reorderStrategySessions(strategyId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = sotReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const result = await runStrategyAction("Couldn't reorder.", () => svc.reorderStrategySessions(user.id, parsed.data.orderedIds));
  rev(strategyId);
  return result;
}
