"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  createMantraSchema,
  dismissRecommendationSchema,
  endSessionSchema,
  preferencesSchema,
  renameCategorySchema,
  startSessionSchema,
  updateMantraSchema,
} from "@/lib/validation/mindset";
import * as mindset from "@/server/services/mindset.service";
import type { MindsetPreferences } from "@/domain/mindset/options";

/** Mindset server actions: authenticate, validate with zod, delegate. */

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

function fail(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof mindset.MindsetError) return { success: false, error: error.message };
  console.error(`[mindset] ${fallback}`, error);
  return { success: false, error: fallback };
}

const firstIssue = (e: { issues: { message: string }[] }) => ({ success: false as const, error: e.issues[0]?.message ?? "Invalid input." });

export async function createMantraAction(input: unknown): Promise<Result<{ mantra: mindset.MantraDTO }>> {
  const user = await requireUser();
  const parsed = createMantraSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const mantra = await mindset.createMantra(user.id, parsed.data);
    revalidatePath("/mindset");
    return { success: true, mantra };
  } catch (e) {
    return fail(e, "Could not add the mantra.");
  }
}

export async function updateMantraAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = updateMantraSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await mindset.updateMantra(user.id, parsed.data.id, parsed.data.patch);
    revalidatePath("/mindset");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the mantra.");
  }
}

export async function deleteMantraAction(id: unknown): Promise<Result> {
  const user = await requireUser();
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return { success: false, error: "Invalid id." };
  try {
    await mindset.deleteMantra(user.id, id);
    revalidatePath("/mindset");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete the mantra.");
  }
}

export async function renameCategoryAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = renameCategorySchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await mindset.renameCategory(user.id, parsed.data.from, parsed.data.to);
    revalidatePath("/mindset");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not rename the category.");
  }
}

export async function savePreferencesAction(input: unknown): Promise<Result<{ preferences: MindsetPreferences }>> {
  const user = await requireUser();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const preferences = await mindset.savePreferences(user.id, parsed.data);
    return { success: true, preferences };
  } catch (e) {
    return fail(e, "Could not save your settings.");
  }
}

export async function startSessionAction(input: unknown): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const parsed = startSessionSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    const { id } = await mindset.startSession(user.id, parsed.data);
    return { success: true, id };
  } catch (e) {
    return fail(e, "Could not start the session.");
  }
}

export async function endSessionAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = endSessionSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await mindset.endSession(user.id, parsed.data.id, parsed.data);
    revalidatePath("/mindset");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not record the session.");
  }
}

export async function dismissRecommendationAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = dismissRecommendationSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  try {
    await mindset.dismissRecommendation(user.id, parsed.data.key);
    revalidatePath("/mindset");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not dismiss the recommendation.");
  }
}
