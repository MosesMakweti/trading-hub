"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  customRuleReorderSchema,
  customRuleSchema,
  partialTakeProfitReorderSchema,
  partialTakeProfitUpdateSchema,
  tradeManagementUpdateSchema,
} from "@/lib/validation/strategy-trade-management";
import * as tmService from "@/server/services/strategy-trade-management.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const revalidate = (strategyId: string) => revalidatePath(`/strategy-lab/${strategyId}`);

// ── Record ───────────────────────────────────────────────────────────────────
export async function updateTradeManagement(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = tradeManagementUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await tmService.updateTradeManagement(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidate(strategyId);
  return { success: true };
}

// ── Partial take-profits ─────────────────────────────────────────────────────
export async function createPartialTakeProfit(
  strategyId: string,
  tradeManagementId: string,
): Promise<CreateResult> {
  const user = await requireUser();
  try {
    const tp = await tmService.createPartialTakeProfit(user.id, tradeManagementId);
    revalidate(strategyId);
    return { success: true, id: tp.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add level.") };
  }
}

export async function updatePartialTakeProfit(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = partialTakeProfitUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await tmService.updatePartialTakeProfit(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function archivePartialTakeProfit(
  strategyId: string,
  id: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await tmService.archivePartialTakeProfit(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete level.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function reorderPartialTakeProfits(
  strategyId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = partialTakeProfitReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await tmService.reorderPartialTakeProfits(
      user.id,
      parsed.data.tradeManagementId,
      parsed.data.orderedIds,
    );
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  revalidate(strategyId);
  return { success: true };
}

// ── Custom rules (wired into SimpleListSection via bound closures) ────────────
export async function createCustomRule(
  strategyId: string,
  tradeManagementId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = customRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await tmService.createCustomRule(user.id, tradeManagementId, parsed.data.text);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add rule.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function updateCustomRule(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = customRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await tmService.updateCustomRule(user.id, id, parsed.data.text);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function archiveCustomRule(strategyId: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await tmService.archiveCustomRule(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete rule.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function reorderCustomRules(
  strategyId: string,
  tradeManagementId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = customRuleReorderSchema.safeParse({ tradeManagementId, orderedIds });
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await tmService.reorderCustomRules(user.id, tradeManagementId, orderedIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  revalidate(strategyId);
  return { success: true };
}
