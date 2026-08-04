import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";

/**
 * Action-layer wrapper around {@link assertDayEditable}: returns a ready-to-return
 * failure result when the day is archived, or null when the mutation may proceed.
 * Keeps every dated action's guard to two lines and translates the domain error
 * into the shared `{ success: false }` shape rather than throwing to the client.
 */
export async function dayEditableGuard(
  userId: string,
  dateKey: string,
): Promise<{ success: false; error: string } | null> {
  try {
    await assertDayEditable(userId, dateKey);
    return null;
  } catch (e) {
    if (e instanceof DayArchivedError) return { success: false, error: e.message };
    throw e;
  }
}
