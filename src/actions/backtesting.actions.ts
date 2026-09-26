"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { isValidDateKey } from "@/lib/date";
import { backtestRunStatusSchema, createBacktestRunSchema } from "@/lib/validation/backtesting";
import * as backtestRunService from "@/server/services/backtest-run.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string; startDateKey: string } | { success: false; error: string };

/** Only errors meant for the trader are passed through verbatim. */
function toUserError(error: unknown, fallback: string): string {
  if (
    error instanceof backtestRunService.BacktestRunValidationError ||
    error instanceof backtestRunService.BacktestRunNotFoundError ||
    error instanceof backtestRunService.BacktestDateOutOfRangeError
  ) {
    return error.message;
  }
  console.error("[backtesting.actions]", error);
  return fallback;
}

function revalidateRun(runId: string) {
  revalidatePath("/backtesting");
  revalidatePath(`/backtesting/${runId}`, "layout");
}

export async function createBacktestRunAction(input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = createBacktestRunSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const run = await backtestRunService.createBacktestRun(user.id, parsed.data);
    revalidatePath("/backtesting");
    return { success: true, id: run.id, startDateKey: parsed.data.startDate };
  } catch (error) {
    return { success: false, error: toUserError(error, "Couldn't create the backtest run.") };
  }
}

export async function setBacktestRunStatusAction(runId: string, status: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = backtestRunStatusSchema.safeParse(status);
  if (!parsed.success) return { success: false, error: "Invalid status." };
  try {
    await backtestRunService.setBacktestRunStatus(user.id, runId, parsed.data);
    revalidateRun(runId);
    return { success: true };
  } catch (error) {
    return { success: false, error: toUserError(error, "Couldn't update the run.") };
  }
}

export async function deleteBacktestRunAction(
  runId: string,
): Promise<{ success: true; storageCleanupFailures: number } | { success: false; error: string }> {
  const user = await requireUser();
  try {
    const result = await backtestRunService.deleteBacktestRun(user.id, runId);
    revalidatePath("/backtesting");
    return { success: true, storageCleanupFailures: result.storageCleanupFailures };
  } catch (error) {
    return { success: false, error: toUserError(error, "Couldn't delete the run.") };
  }
}

/** Called by the Session shell once a date is actually open — the stored,
 *  server-side resume pointer. Never marks the day complete. */
export async function recordBacktestPositionAction(runId: string, dateKey: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isValidDateKey(dateKey)) return { success: false, error: "Invalid date." };
  try {
    const recorded = await backtestRunService.recordBacktestPosition(user.id, runId, dateKey);
    if (recorded) revalidatePath("/backtesting");
    return { success: true };
  } catch (error) {
    return { success: false, error: toUserError(error, "Couldn't save your position.") };
  }
}
