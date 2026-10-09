"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { runLive } from "@/server/workspace/scope";
import {
  PreparationError,
  acknowledgePreparationNotice,
  addPreparationException,
  confirmPreparationSchedule,
  getPreparationScheduleOverview,
} from "@/server/services/preparation.service";
import { TimezoneChangeError, getTraderTimezoneState, setTraderTimezone } from "@/server/services/trader-time.service";
import { toPreparationSettingsDTO } from "@/server/services/preparation.mapper";
import { preparationExceptionSchema, preparationNoticeSchema, preparationScheduleSchema } from "@/lib/validation/preparation";
import type { PreparationSettingsDTO } from "@/types/preparation";

/**
 * Preparation Score — server actions (Phase 3). Every action acts on the
 * AUTHENTICATED user only: no action accepts a userId, and record ids are
 * matched together with that user server-side. Preparation is live-only, so
 * each write runs in the LIVE scope.
 */

type Result<T = Record<never, never>> = ({ success: true } & T) | { success: false; error: string };

function revalidate() {
  revalidatePath("/settings/routine");
  revalidatePath("/settings");
  revalidatePath("/today");
}

async function settingsFor(userId: string): Promise<PreparationSettingsDTO> {
  const [overview, trader] = await Promise.all([getPreparationScheduleOverview(userId), getTraderTimezoneState(userId)]);
  return toPreparationSettingsDTO(overview, trader);
}

/**
 * Confirms the Preparation Schedule (from the next local date). The timezone
 * IS the trader's canonical timezone: when the form's zone differs from the
 * one already in effect / scheduled, the trading timezone is changed first
 * (same next-date boundary, and the schedule is re-versioned with it), then
 * the target and weekdays are confirmed in that zone.
 */
export async function savePreparationScheduleAction(input: unknown): Promise<Result<{ settings: PreparationSettingsDTO }>> {
  const user = await requireUser();
  const parsed = preparationScheduleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule." };
  const { timezone, targetMinutes, weekdays } = parsed.data;
  try {
    await runLive(async () => {
      const tz = await getTraderTimezoneState(user.id);
      const target = tz.pending?.timezone ?? tz.timezone;
      if (!tz.configured || target !== timezone) await setTraderTimezone(user.id, timezone);
      await confirmPreparationSchedule(user.id, { targetMinutes, weekdays });
    });
  } catch (e) {
    if (e instanceof PreparationError || e instanceof TimezoneChangeError) return { success: false, error: e.message };
    throw e;
  }
  revalidate();
  return { success: true, settings: await settingsFor(user.id) };
}

/** Marks an upcoming date DAY_OFF / EXTRA_DAY. The service decides whether it's still allowed (before that day's target). */
export async function addPreparationExceptionAction(input: unknown): Promise<Result<{ settings: PreparationSettingsDTO }>> {
  const user = await requireUser();
  const parsed = preparationExceptionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid date." };
  try {
    await runLive(() => addPreparationException(user.id, parsed.data.dateKey, parsed.data.kind, new Date(), parsed.data.note));
  } catch (e) {
    if (e instanceof PreparationError) return { success: false, error: e.message };
    throw e;
  }
  revalidate();
  return { success: true, settings: await settingsFor(user.id) };
}

/** Dismisses the streak-break notice. Scoped to the signed-in user's own record; another user's id is a no-op. */
export async function acknowledgePreparationNoticeAction(input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = preparationNoticeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid notice." };
  await acknowledgePreparationNotice(user.id, parsed.data.recordId);
  revalidatePath("/today");
  return { success: true };
}
