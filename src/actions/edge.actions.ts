"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { weeklyReviewSchema } from "@/lib/validation/edge";
import * as edgeService from "@/server/services/edge.service";

type SimpleResult = { success: true } | { success: false; error: string };

export async function updateWeeklyReview(
  weekStartKey: string,
  input: unknown,
): Promise<SimpleResult> {
  const user = await requireUser();
  const parsed = weeklyReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await edgeService.upsertWeeklyReview(user.id, weekStartKey, parsed.data);
  revalidatePath("/edge");
  return { success: true };
}
