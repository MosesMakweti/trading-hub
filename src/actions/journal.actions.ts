"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { dailyNoteSchema, dateKeySchema } from "@/lib/validation/journal";
import * as journalService from "@/server/services/journal.service";

type ActionResult = { success: true } | { success: false; error: string };

export async function updateDailyNote(dateKey: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();

  const parsedDate = dateKeySchema.safeParse(dateKey);
  if (!parsedDate.success) return { success: false, error: "Invalid date." };

  const parsed = dailyNoteSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  await journalService.upsertDailyNote(user.id, parsedDate.data, parsed.data);
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath("/journal");
  return { success: true };
}
