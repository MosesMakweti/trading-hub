"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { runInRecordScope } from "@/server/workspace/action-scope";
import { tradeExecutionEditableGuard } from "@/actions/day-guard";
import { reviewFieldsSchema, reviewIntentSchema, reviewPsychologySchema } from "@/lib/validation/trade-review-v3";
import * as review from "@/server/services/trade-review-v3.service";
import type { V3ReviewDTO } from "@/server/services/trade-review-v3.service";

type Failure = { success: false; error: string };
type SimpleResult = { success: true } | Failure;

function fail(error: unknown, fallback: string): Failure {
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

function revalidateReview(dateKey: string, tradeId: string) {
  revalidatePath("/today");
  revalidatePath(`/journal/${dateKey}`);
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
}

/** The normal execution/review guard, plus the V3 carve-out: a carried
 *  position whose FINAL review is still outstanding stays reviewable after
 *  its own day archives (review-v3.service reviewWritableOnArchivedDay). */
async function reviewGuard(userId: string, dateKey: string, tradeId: string): Promise<Failure | null> {
  const blocked = await tradeExecutionEditableGuard(userId, dateKey, tradeId);
  if (!blocked) return null;
  return (await review.reviewWritableOnArchivedDay(userId, tradeId)) ? null : blocked;
}

export async function loadV3ReviewAction(tradeId: string): Promise<{ success: true; data: V3ReviewDTO } | Failure> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "read", async () => {
    try {
      return { success: true as const, data: await review.getV3ReviewData(user.id, tradeId) };
    } catch (error) {
      return fail(error, "Could not load the review.");
    }
  });
}

export async function setReviewIntentAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await reviewGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    const parsed = reviewIntentSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await review.setReviewTradeIntent(user.id, tradeId, parsed.data.tradeIntent);
    } catch (error) {
      return fail(error, "Could not save the motive.");
    }
    revalidateReview(dateKey, tradeId);
    return { success: true };
  });
}

export async function updateReviewFieldsAction(dateKey: string, tradeId: string, input: unknown): Promise<SimpleResult> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await reviewGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    const parsed = reviewFieldsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      await review.updateReviewFields(user.id, tradeId, parsed.data);
    } catch (error) {
      return fail(error, "Could not save the review.");
    }
    revalidateReview(dateKey, tradeId);
    return { success: true };
  });
}

export async function saveReviewPsychologyAction(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<{ success: true; complete: boolean; missing: string[] } | Failure> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await reviewGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    const parsed = reviewPsychologySchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      const r = await review.saveReviewPsychology(user.id, tradeId, parsed.data.answers);
      revalidateReview(dateKey, tradeId);
      return { success: true as const, ...r };
    } catch (error) {
      return fail(error, "Could not save the psychology answers.");
    }
  });
}

export async function completeReviewAction(
  dateKey: string,
  tradeId: string,
): Promise<{ success: true; mode: "FINAL" | "INTERIM" } | Failure> {
  const user = await requireUser();
  return runInRecordScope(user.id, { trade: tradeId }, "write", async () => {
    const blocked = await reviewGuard(user.id, dateKey, tradeId);
    if (blocked) return blocked;
    try {
      const r = await review.completeReview(user.id, tradeId);
      revalidateReview(dateKey, tradeId);
      return { success: true as const, mode: r.mode };
    } catch (error) {
      return fail(error, "Could not complete the review.");
    }
  });
}
