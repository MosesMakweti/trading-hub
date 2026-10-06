"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { setTraderTimezone, TimezoneChangeError, type TraderTimezoneState } from "@/server/services/trader-time.service";

/** Confirms the trader's timezone. It governs from the next local date — today never moves. */
export async function setTraderTimezoneAction(
  timezone: string,
): Promise<{ success: true; state: TraderTimezoneState } | { success: false; error: string }> {
  const user = await requireUser();
  if (typeof timezone !== "string") return { success: false, error: "Choose a valid timezone." };
  try {
    const state = await setTraderTimezone(user.id, timezone);
    revalidatePath("/settings");
    revalidatePath("/today");
    return { success: true, state };
  } catch (e) {
    if (e instanceof TimezoneChangeError) return { success: false, error: e.message };
    throw e;
  }
}
