"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { runInDayScope } from "@/server/workspace/action-scope";
import type { WorkspaceDayRef } from "@/lib/validation/workspace";
import { dayEditableGuard } from "@/actions/day-guard";
import { dailyNoteSchema, dateKeySchema } from "@/lib/validation/journal";
import * as journalService from "@/server/services/journal.service";

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Day-level (explicit environment). LIVE keeps its rule: an archived day's note
 * is locked until the day is reopened. BACKTEST: a note is the reviewer's own
 * annotation of a simulated day, so it stays editable after the day is closed
 * — only a completed/archived RUN is read-only (enforced by runInDayScope).
 */
export async function updateDailyNote(day: WorkspaceDayRef, input: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsedDate = dateKeySchema.safeParse(day?.dateKey);
  if (!parsedDate.success) return { success: false, error: "Invalid date." };

  return runInDayScope(user.id, day, "write", async (dateKey) => {
    if (day.runId == null) {
      const blocked = await dayEditableGuard(user.id, dateKey);
      if (blocked) return blocked;
    }

    const parsed = dailyNoteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid input." };

    await journalService.upsertDailyNote(user.id, dateKey, parsed.data);
    revalidatePath(`/journal/${dateKey}`);
    revalidatePath("/journal");
    return { success: true };
  });
}
