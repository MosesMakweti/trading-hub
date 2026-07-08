"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { reorderSchema, tradingSessionSchema } from "@/lib/validation/trading-plan";
import * as tradingSessionsService from "@/server/services/trading-sessions.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function createTradingSession(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = tradingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await tradingSessionsService.createTradingSession(user.id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function updateTradingSession(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = tradingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await tradingSessionsService.updateTradingSession(user.id, id, parsed.data);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function archiveTradingSession(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await tradingSessionsService.archiveTradingSession(user.id, id);
  revalidatePath("/settings/plan");
  return { success: true };
}

export async function reorderTradingSessions(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await tradingSessionsService.reorderTradingSessions(user.id, parsed.data.orderedIds);
  revalidatePath("/settings/plan");
  return { success: true };
}
