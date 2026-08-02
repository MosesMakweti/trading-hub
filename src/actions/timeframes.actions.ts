"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  checkpointCreateSchema,
  checkpointReorderSchema,
  checkpointUpdateSchema,
  timeframeCreateSchema,
  timeframeRenameSchema,
  timeframeReorderSchema,
} from "@/lib/validation/timeframes";
import * as timeframesService from "@/server/services/timeframes.service";

type ActionResult = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const revalidate = (strategyId: string) => revalidatePath(`/strategy-lab/${strategyId}`);

// ── Timeframes ───────────────────────────────────────────────────────────────
export async function createTimeframe(strategyId: string, input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = timeframeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const tf = await timeframesService.createTimeframe(user.id, strategyId, parsed.data.name);
    revalidate(strategyId);
    return { success: true, id: tf.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add timeframe.") };
  }
}

export async function renameTimeframe(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = timeframeRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await timeframesService.renameTimeframe(user.id, id, parsed.data.name);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to rename.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function archiveTimeframe(strategyId: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await timeframesService.archiveTimeframe(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete timeframe.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function reorderTimeframes(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = timeframeReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await timeframesService.reorderTimeframes(user.id, parsed.data.strategyId, parsed.data.orderedIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  revalidate(parsed.data.strategyId);
  return { success: true };
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
export async function createCheckpoint(
  strategyId: string,
  timeframeId: string,
  input: unknown,
): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = checkpointCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const cp = await timeframesService.createCheckpoint(user.id, timeframeId, parsed.data.title);
    revalidate(strategyId);
    return { success: true, id: cp.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to add checkpoint.") };
  }
}

export async function updateCheckpoint(
  strategyId: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checkpointUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await timeframesService.updateCheckpoint(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function archiveCheckpoint(strategyId: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await timeframesService.archiveCheckpoint(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete checkpoint.") };
  }
  revalidate(strategyId);
  return { success: true };
}

export async function reorderCheckpoints(
  strategyId: string,
  input: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = checkpointReorderSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await timeframesService.reorderCheckpoints(
      user.id,
      parsed.data.timeframeId,
      parsed.data.orderedIds,
    );
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reorder.") };
  }
  revalidate(strategyId);
  return { success: true };
}
