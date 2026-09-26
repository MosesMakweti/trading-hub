"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { runInDayScope } from "@/server/workspace/action-scope";
import { dayEditableGuard } from "@/actions/day-guard";
import { routineResponseSchema } from "@/lib/validation/routine";
import * as dayRoutineService from "@/server/services/today-routine.service";
import { RoutineGateError } from "@/server/services/today-routine.service";

type SimpleResult = { success: true } | { success: false; error: string };

// Save one routine item's response for the day (checkbox tick or text note).
export async function saveRoutineResponse(
  day: WorkspaceDayRef,
  itemId: string,
  input: unknown,
): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    const parsed = routineResponseSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid input." };

    try {
      await dayRoutineService.setRoutineResponse(user.id, dateKey, itemId, parsed.data);
    } catch {
      return { success: false, error: "Could not save." };
    }
    revalidatePath("/today");
    return { success: true };
  });
}

// The "I am ready to trade" gate — unlocks the rest of the Today workflow.
export async function setRoutineReady(day: WorkspaceDayRef, ready: boolean): Promise<SimpleResult> {
  const user = await requireUser();
  return runInDayScope(user.id, day, "write", async (dateKey) => {
    const blocked = await dayEditableGuard(user.id, dateKey);
    if (blocked) return blocked;

    try {
      await dayRoutineService.setRoutineReady(user.id, dateKey, Boolean(ready));
    } catch (e) {
      if (e instanceof RoutineGateError) return { success: false, error: e.message };
      throw e;
    }
    revalidatePath("/today");
    return { success: true };
  });
}
