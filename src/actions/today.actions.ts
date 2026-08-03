"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { morningPrepSchema, todaysPlanSchema } from "@/lib/validation/today";
import * as tradingDayService from "@/server/services/trading-day.service";

type SimpleResult = { success: true } | { success: false; error: string };

export async function updateMorningPrep(dateKey: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  const parsed = morningPrepSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await tradingDayService.updateMorningPrep(user.id, dateKey, parsed.data);
  revalidatePath("/today");
  return { success: true };
}

export async function updateTodaysPlan(dateKey: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  const parsed = todaysPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await tradingDayService.updateTodaysPlan(user.id, dateKey, parsed.data);
  revalidatePath("/today");
  return { success: true };
}
