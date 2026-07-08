"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  dailyRoutineSchema,
  profitTakingSchema,
  riskManagementSchema,
  stopLossSchema,
  strategyFrameworkSchema,
} from "@/lib/validation/trading-plan";
import * as tradingPlanService from "@/server/services/trading-plan.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function updateDailyRoutine(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = dailyRoutineSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingPlanService.updateDailyRoutine(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateStrategyFramework(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = strategyFrameworkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingPlanService.updateStrategyFramework(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateProfitTakingRules(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = profitTakingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingPlanService.updateProfitTakingRules(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateStopLossPlacement(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = stopLossSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingPlanService.updateStopLossPlacement(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateRiskManagement(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = riskManagementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingPlanService.updateRiskManagement(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}
