"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { dayEditableGuard } from "@/actions/day-guard";
import * as performanceAccountService from "@/server/services/performance-account.service";
import type { PerformanceRiskContext } from "@/server/services/performance-account.service";

type ActionResult = { success: true } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Today V2 (T3) — read-only context for the Trade Idea's Performance
 * Account row (risk %, balance, derived risk amount, locked state). No
 * day-edit guard needed since nothing is written.
 */
export async function getPerformanceRiskContextAction(
  tradeId: string,
): Promise<{ success: true; data: PerformanceRiskContext } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const data = await performanceAccountService.getPerformanceRiskContext(user.id, tradeId);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not load Performance Account risk.") };
  }
}

/**
 * The pre-execution risk% override surface — the only place a trader can
 * adjust the Performance Account's risk for a trade before it locks (the
 * service itself rejects the change once a risk snapshot already exists).
 */
export async function updatePerformanceRiskOverrideAction(
  dateKey: string,
  tradeId: string,
  riskPercent: number,
): Promise<ActionResult> {
  const user = await requireUser();
  const blocked = await dayEditableGuard(user.id, dateKey);
  if (blocked) return blocked;

  try {
    await performanceAccountService.updatePerformanceRiskOverride(user.id, tradeId, riskPercent);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update risk.") };
  }
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/today");
  return { success: true };
}
