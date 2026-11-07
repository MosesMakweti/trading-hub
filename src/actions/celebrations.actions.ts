"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import {
  dismissCelebrations,
  getPendingCelebrations,
  setCelebrationPreferences,
} from "@/server/services/achievements.service";
import type { CelebrationDTO, CelebrationPreferencesDTO } from "@/types/achievements";

/**
 * The celebration queue. Every action acts for the signed-in user only; no
 * userId is ever accepted from the client.
 */

/** Unseen celebrations. Read-only: nothing is marked seen until dismissed. */
export async function getPendingCelebrationsAction(): Promise<CelebrationDTO[]> {
  const user = await requireUser();
  return getPendingCelebrations(user.id);
}

const dismissSchema = z.object({ ids: z.array(z.string().min(1)).max(200).nullable() });

/** Dismisses the given celebrations (null = all). Each is written seen once and never shown again. */
export async function dismissCelebrationsAction(ids: string[] | null): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = dismissSchema.safeParse({ ids });
  if (!parsed.success) return { success: false, error: "Invalid input." };
  await dismissCelebrations(user.id, parsed.data.ids);
  revalidatePath("/dashboard");
  revalidatePath("/discipline");
  return { success: true };
}

const prefsSchema = z.object({ animations: z.boolean().optional(), sound: z.boolean().optional() });

export async function setCelebrationPreferencesAction(
  input: unknown,
): Promise<{ success: true; data: CelebrationPreferencesDTO } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  const data = await setCelebrationPreferences(user.id, parsed.data);
  revalidatePath("/settings");
  return { success: true, data };
}
