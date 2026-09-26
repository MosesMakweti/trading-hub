"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope } from "@/server/workspace/action-scope";
import { dayEditableGuard } from "@/actions/day-guard";
import { todaysPlanSchema } from "@/lib/validation/today";
import * as tradingDayService from "@/server/services/trading-day.service";

type SimpleResult = { success: true } | { success: false; error: string };

export async function updateTodaysPlan(day: WorkspaceDayRef, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = todaysPlanSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    await tradingDayService.updateTodaysPlan(user.id, dateKey, parsed.data);
    revalidatePath("/today");
    return { success: true };
  });
}

export async function setDayAnalyzed(day: WorkspaceDayRef, analyzed: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    await tradingDayService.setDayAnalyzed(user.id, dateKey, Boolean(analyzed));
    revalidatePath("/today");
    return { success: true };
  });
}

export async function endDay(day: WorkspaceDayRef): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    await tradingDayService.endDay(user.id, dateKey);
    revalidatePath("/today");
    revalidatePath("/journal");
    return { success: true };
  });
}

export async function reopenDay(day: WorkspaceDayRef): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    await tradingDayService.reopenDay(user.id, dateKey);
    revalidatePath("/today");
    revalidatePath("/journal");
    return { success: true };
  });
}
