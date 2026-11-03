"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import { runLive } from "@/server/workspace/scope";
import { acknowledgeAchievements } from "@/server/services/discipline-streaks.service";
import { ACHIEVEMENTS } from "@/domain/discipline/streaks";

const KNOWN_KEYS = new Set(ACHIEVEMENTS.map((a) => a.key));
const acknowledgeSchema = z.object({ keys: z.array(z.string().refine((k) => KNOWN_KEYS.has(k))).max(ACHIEVEMENTS.length).nullable() });

/**
 * Dismisses the "achievement unlocked" celebration. Authenticated user only;
 * no userId is accepted, so it can only ever touch the caller's own rows.
 */
export async function acknowledgeAchievementsAction(
  keys: string[] | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  const parsed = acknowledgeSchema.safeParse({ keys });
  if (!parsed.success) return { success: false, error: "Invalid input." };
  await runLive(() => acknowledgeAchievements(user.id, parsed.data.keys));
  revalidatePath("/dashboard");
  revalidatePath("/discipline");
  return { success: true };
}
