"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope } from "@/server/workspace/action-scope";
import { dayEditableGuard } from "@/actions/day-guard";
import { dailyReflectionSchema, closeTradingDaySchema } from "@/lib/validation/close-day";
import * as closeDayService from "@/server/services/close-day.service";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";

type SimpleResult = { success: true } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function loadDayCloseSummaryAction(
  day: WorkspaceDayRef,
): Promise<{ success: true; data: DayCloseSummaryDTO } | { success: false; error: string }> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "read", async (dateKey) => {
    try {
      const data = await closeDayService.getDayCloseSummary(user.id, dateKey);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: errorMessage(error, "Could not load the day summary.") };
    }
  });
}

export async function saveDailyReflectionAction(day: WorkspaceDayRef, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = dailyReflectionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    try {
      await closeDayService.saveDailyReflection(user.id, dateKey, parsed.data);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to save.") };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

export async function closeTradingDayAction(day: WorkspaceDayRef, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const parsed = closeTradingDaySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    try {
      await closeDayService.closeTradingDay(user.id, dateKey, parsed.data);
    } catch (error) {
      return { success: false, error: errorMessage(error, "Failed to close the day.") };
    }
    revalidatePath("/today");
    revalidatePath("/journal");
    return { success: true };
  });
}
