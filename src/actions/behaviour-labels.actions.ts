"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  behaviourLabelCreateSchema,
  behaviourLabelUpdateSchema,
  setTradeBehaviourLabelsSchema,
} from "@/lib/validation/behaviour-labels";
import * as svc from "@/server/services/behaviour-labels.service";

type Result = { success: true } | { success: false; error: string };
type CreateResult = { success: true; id: string } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function listBehaviourLabelsAction() {
  const user = await requireUser();
  return svc.listBehaviourLabels(user.id);
}

export async function createBehaviourLabelAction(input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = behaviourLabelCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const label = await svc.createBehaviourLabel(user.id, parsed.data);
    return { success: true, id: label.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create the label.") };
  }
}

export async function updateBehaviourLabelAction(id: string, input: unknown): Promise<Result> {
  const user = await requireUser();
  const parsed = behaviourLabelUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await svc.updateBehaviourLabel(user.id, id, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save.") };
  }
  return { success: true };
}

export async function archiveBehaviourLabelAction(id: string): Promise<Result> {
  const user = await requireUser();
  try {
    await svc.archiveBehaviourLabel(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete the label.") };
  }
  return { success: true };
}

export async function loadTradeBehaviourLabelsAction(tradeId: string) {
  const user = await requireUser();
  return svc.listTradeBehaviourLabels(user.id, tradeId);
}

export async function setTradeBehaviourLabelsAction(
  dateKey: string,
  tradeId: string,
  input: unknown,
): Promise<Result> {
  const user = await requireUser();
  const parsed = setTradeBehaviourLabelsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };
  try {
    await svc.setTradeBehaviourLabels(user.id, tradeId, parsed.data.labelIds);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save behaviour labels.") };
  }
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  return { success: true };
}
