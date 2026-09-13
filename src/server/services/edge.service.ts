import { Prisma, type ReplayReviewType, type WeeklyReview } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate } from "@/lib/date";
import type { WeeklyReviewInput } from "@/lib/validation/edge";

const REVIEW_FIELDS = ["wentWell", "toImprove", "focusNextWeek"] as const;

/**
 * Edge Review's final reflection (Stage 12.5 "Improvements" stage) — kept
 * keyed by (userId, periodStart, reviewType) on the SAME durable WeeklyReview
 * model Edge Review already had; `periodStartKey` doubles as a month-start
 * key for MONTHLY reviews (see the schema's own doc comment). This is
 * deliberately NOT ReplayReviewSession.notes — that stays *working* notes
 * during Replay; this is the one final reflection per period.
 */
export async function getWeeklyReview(
  userId: string,
  periodStartKey: string,
  reviewType: ReplayReviewType = "WEEKLY",
): Promise<WeeklyReview | null> {
  return prisma.weeklyReview.findFirst({
    where: { userId, weekStart: dateKeyToUtcDate(periodStartKey), reviewType },
  });
}

async function getOrCreateWeeklyReview(
  userId: string,
  weekStart: Date,
  reviewType: ReplayReviewType,
): Promise<WeeklyReview> {
  return prisma.weeklyReview.upsert({
    where: { userId_weekStart_reviewType: { userId, weekStart, reviewType } },
    update: {},
    create: { userId, weekStart, reviewType },
  });
}

/** Applies a reflection patch (only the provided rich-text sections). */
export async function upsertWeeklyReview(
  userId: string,
  periodStartKey: string,
  reviewType: ReplayReviewType,
  input: WeeklyReviewInput,
): Promise<WeeklyReview> {
  const review = await getOrCreateWeeklyReview(userId, dateKeyToUtcDate(periodStartKey), reviewType);

  const data: Prisma.WeeklyReviewUpdateInput = {};
  const record = input as Record<string, unknown>;
  for (const key of REVIEW_FIELDS) {
    if (key in record) {
      data[key] = record[key] == null ? Prisma.DbNull : (record[key] as Prisma.InputJsonValue);
    }
  }

  return prisma.weeklyReview.update({ where: { id: review.id }, data });
}
