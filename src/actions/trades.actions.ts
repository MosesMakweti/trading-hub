"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { tradeSchema } from "@/lib/validation/trades";
import * as tradesService from "@/server/services/trades.service";

type ActionResult = { success: true; tradeId: string } | { success: false; error: string };
type SimpleResult = { success: true } | { success: false; error: string };

export async function createTrade(dateKey: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = tradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const trade = await tradesService.createTrade(user.id, dateKey, parsed.data);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true, tradeId: trade.id };
}

export async function updateTrade(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = tradeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const trade = await tradesService.updateTrade(user.id, tradeId, parsed.data);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true, tradeId: trade.id };
}

export async function archiveTrade(dateKey: string, tradeId: string): Promise<SimpleResult> {
  const user = await requireUser();
  await tradesService.archiveTrade(user.id, tradeId);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true };
}
