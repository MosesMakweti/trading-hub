"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import { weeklyReviewSchema } from "@/lib/validation/edge";
import * as edgeService from "@/server/services/edge.service";

type SimpleResult = { success: true } | { success: false; error: string };

const reviewTypeSchema = z.enum(["WEEKLY", "MONTHLY"]);

export async function updateWeeklyReview(
  periodStartKey: string,
  reviewType: unknown,
  input: unknown,
): Promise<SimpleResult> {
  const user = await requireUser();
  const parsedType = reviewTypeSchema.safeParse(reviewType);
  if (!parsedType.success) return { success: false, error: "Invalid review type." };

  const parsed = weeklyReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await edgeService.upsertWeeklyReview(user.id, periodStartKey, parsedType.data, parsed.data);
  revalidatePath("/edge");
  return { success: true };
}
