"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  routineItemSchema,
  routineItemUpdateSchema,
  routineReorderSchema,
  routineSectionSchema,
} from "@/lib/validation/routine";
import * as routineService from "@/server/services/routine.service";

type ActionResult = { success: true } | { success: false; error: string };

const ROUTINE_PATH = "/settings/routine";
const invalid = (msg?: string): ActionResult => ({ success: false, error: msg ?? "Invalid input." });

// ---- Sections ------------------------------------------------------------

export async function createRoutineSection(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineSectionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await routineService.createSection(user.id, parsed.data);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function renameRoutineSection(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineSectionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await routineService.renameSection(user.id, id, parsed.data);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function setRoutineSectionCollapsed(
  id: string,
  collapsed: boolean,
): Promise<ActionResult> {
  const user = await requireUser();
  await routineService.setSectionCollapsed(user.id, id, Boolean(collapsed));
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function deleteRoutineSection(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await routineService.deleteSection(user.id, id);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function reorderRoutineSections(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  await routineService.reorderSections(user.id, parsed.data.orderedIds);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

// ---- Items ---------------------------------------------------------------

export async function createRoutineItem(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineItemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await routineService.createItem(user.id, parsed.data);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function updateRoutineItem(id: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineItemUpdateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  await routineService.updateItem(user.id, id, parsed.data);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function deleteRoutineItem(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await routineService.deleteItem(user.id, id);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}

export async function reorderRoutineItems(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = routineReorderSchema.safeParse(input);
  if (!parsed.success) return invalid();
  await routineService.reorderItems(user.id, parsed.data.orderedIds);
  revalidatePath(ROUTINE_PATH);
  return { success: true };
}
