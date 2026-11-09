"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  setupScenarioConditionAddSchema,
  setupScenarioConditionReorderSchema,
  setupScenarioConditionUpdateSchema,
  setupScenarioCreateSchema,
  setupScenarioDetailsSchema,
  setupScenarioReorderSchema,
  setupScenarioUpdateSchema,
  setupTypeCreateSchema,
  setupTypeReorderSchema,
  setupTypeUpdateSchema,
} from "@/lib/validation/strategy-setup-types";
import * as svc from "@/server/services/strategy-setup-types.service";
import type { EffectiveSetupScenario } from "@/server/services/strategy-setup-types.service";

type Result = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

const rev = (strategyId: string) => revalidatePath(`/strategy-lab/${strategyId}`);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Trade Idea Validation Shield (Stage 4) — the exact read path the "Add
 * Trade Idea" flow uses to load a Setup Type's live checklist for the
 * trader's chosen direction. Without an explicit scenario, the first scenario
 * matching the direction (then the first Neutral one) is used. Read-only.
 */
export async function loadEffectiveScenario(
  setupTypeId: string,
  direction: "LONG" | "SHORT",
  scenarioId?: string | null,
): Promise<EffectiveSetupScenario | null> {
  const user = await requireUser();
  return svc.getEffectiveScenario(user.id, setupTypeId, direction, scenarioId);
}

// ── Setup Types ───────────────────────────────────────────────────────────────

export async function createSetupType(strategyId: string, input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = setupTypeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const setupType = await svc.createSetupType(user.id, strategyId, parsed.data);
    rev(strategyId);
    return { success: true, id: setupType.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create setup type.") };
  }
}

export async function updateSetupType(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupTypeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.updateSetupType(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function archiveSetupType(strategyId: string, id: string): Promise<Result> {
  const user = await requireUser();
  try {
    await svc.archiveSetupType(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete setup type.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function reorderSetupTypes(strategyId: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = setupTypeReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await svc.reorderSetupTypes(user.id, strategyId, parsed.data.orderedIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  rev(strategyId);
  return { success: true };
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

export async function updateScenarioDescription(
  strategyId: string,
  scenarioId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.updateScenarioDescription(user.id, scenarioId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function createScenario(
  strategyId: string,
  setupTypeId: string,
  input: unknown,
): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = setupScenarioCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const scenario = await svc.createScenario(user.id, setupTypeId, parsed.data);
    rev(strategyId);
    return { success: true, id: scenario.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add scenario.") };
  }
}

export async function updateScenarioDetails(
  strategyId: string,
  scenarioId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.updateScenarioDetails(user.id, scenarioId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function duplicateScenario(strategyId: string, scenarioId: string): Promise<CreateResult> {
  const user = await requireUser();
  try {
    const copy = await svc.duplicateScenario(user.id, scenarioId);
    rev(strategyId);
    return { success: true, id: copy.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to duplicate scenario.") };
  }
}

export async function archiveScenario(strategyId: string, scenarioId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await svc.archiveScenario(user.id, scenarioId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove scenario.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function reorderScenarios(
  strategyId: string,
  setupTypeId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await svc.reorderScenarios(user.id, setupTypeId, parsed.data.orderedIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  rev(strategyId);
  return { success: true };
}

// ── Scenario conditions ──────────────────────────────────────────────────────

export async function addScenarioCondition(
  strategyId: string,
  scenarioId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioConditionAddSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.addScenarioCondition(user.id, scenarioId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add condition.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function updateScenarioCondition(
  strategyId: string,
  conditionId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioConditionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.updateScenarioCondition(user.id, conditionId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function removeScenarioCondition(
  strategyId: string,
  conditionId: string,
): Promise<Result> {
  const user = await requireUser();
  try {
    await svc.removeScenarioCondition(user.id, conditionId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove condition.") };
  }
  rev(strategyId);
  return { success: true };
}

export async function reorderScenarioConditions(
  strategyId: string,
  scenarioId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setupScenarioConditionReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await svc.reorderScenarioConditions(user.id, scenarioId, parsed.data.orderedIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  rev(strategyId);
  return { success: true };
}
