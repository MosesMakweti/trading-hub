import { Prisma, type WeeklyReview } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate } from "@/lib/date";
import type { WeeklyReviewInput } from "@/lib/validation/edge";

const REVIEW_FIELDS = ["wentWell", "toImprove", "focusNextWeek"] as const;

/** The weekly review for a week (keyed by the week's Monday), or null. */
export async function getWeeklyReview(
  userId: string,
  weekStartKey: string,
): Promise<WeeklyReview | null> {
  return prisma.weeklyReview.findFirst({
    where: { userId, weekStart: dateKeyToUtcDate(weekStartKey) },
  });
}

async function getOrCreateWeeklyReview(userId: string, weekStart: Date): Promise<WeeklyReview> {
  return prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    update: {},
    create: { userId, weekStart },
  });
}

/** Applies a reflection patch (only the provided rich-text sections). */
export async function upsertWeeklyReview(
  userId: string,
  weekStartKey: string,
  input: WeeklyReviewInput,
): Promise<WeeklyReview> {
  const review = await getOrCreateWeeklyReview(userId, dateKeyToUtcDate(weekStartKey));

  const data: Prisma.WeeklyReviewUpdateInput = {};
  const record = input as Record<string, unknown>;
  for (const key of REVIEW_FIELDS) {
    if (key in record) {
      data[key] = record[key] == null ? Prisma.DbNull : (record[key] as Prisma.InputJsonValue);
    }
  }

  return prisma.weeklyReview.update({ where: { id: review.id }, data });
}
