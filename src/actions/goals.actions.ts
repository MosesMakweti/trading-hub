"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import { createGoalSchema, goalCheckInSchema, updateGoalSchema } from "@/lib/validation/goals";
import {
  GoalError,
  abandonGoal,
  createGoal,
  pauseGoal,
  resumeGoal,
  setGoalCheckIn,
  updateGoal,
} from "@/server/services/goals.service";

/**
 * Goals — the trader's single consecutive-day commitment. Every action acts
 * for the signed-in user only; no userId is ever accepted from the client.
 */

type Result<T = undefined> = ({ success: true } & (T extends undefined ? unknown : { data: T })) | { success: false; error: string };

const idSchema = z.string().min(1);

function revalidateGoals() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  revalidatePath("/discipline");
}

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    console.error("[goals] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function createGoalAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const r = await run(() => createGoal(user.id, parsed.data));
  if (!r.ok) return { success: false, error: r.error };
  revalidateGoals();
  return { success: true, data: r.value };
}

export async function updateGoalAction(goalId: unknown, input: unknown): Promise<Result> {
  const user = await requireUser();
  const id = idSchema.safeParse(goalId);
  const parsed = updateGoalSchema.safeParse(input);
  if (!id.success || !parsed.success) {
    return { success: false, error: parsed.success ? "Invalid goal." : (parsed.error.issues[0]?.message ?? "Invalid input.") };
  }
  const r = await run(() => updateGoal(user.id, id.data, parsed.data));
  if (!r.ok) return { success: false, error: r.error };
  revalidateGoals();
  return { success: true };
}

function lifecycle(fn: (userId: string, goalId: string) => Promise<void>) {
  return async (goalId: unknown): Promise<Result> => {
    const user = await requireUser();
    const id = idSchema.safeParse(goalId);
    if (!id.success) return { success: false, error: "Invalid goal." };
    const r = await run(() => fn(user.id, id.data));
    if (!r.ok) return { success: false, error: r.error };
    revalidateGoals();
    return { success: true };
  };
}

export async function pauseGoalAction(goalId: unknown): Promise<Result> {
  return lifecycle(pauseGoal)(goalId);
}

export async function resumeGoalAction(goalId: unknown): Promise<Result> {
  return lifecycle(resumeGoal)(goalId);
}

export async function abandonGoalAction(goalId: unknown): Promise<Result> {
  return lifecycle(abandonGoal)(goalId);
}

export async function setGoalCheckInAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = goalCheckInSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const r = await run(() => setGoalCheckIn(user.id, parsed.data));
  if (!r.ok) return { success: false, error: r.error };
  revalidateGoals();
  return { success: true };
}
