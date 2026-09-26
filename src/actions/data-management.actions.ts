"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  deleteDataSection,
  resetAllData,
  type DataSection,
} from "@/server/services/data-management.service";

type SimpleResult = { success: true } | { success: false; error: string };

const SECTIONS: DataSection[] = [
  "backtesting",
  "journal-trades",
  "today-plans",
  "strategies",
  "psychology",
  "accounts",
  "routine",
  "notes",
];

/**
 * Deletes one section of the signed-in user's data. Scoped to `user.id` in the
 * service (a trader can never touch another user's data). Revalidates the whole
 * app tree so derived analytics + counts refresh with no stale cache.
 */
export async function deleteDataSectionAction(section: DataSection): Promise<SimpleResult> {
  const user = await requireUser();
  if (!SECTIONS.includes(section)) return { success: false, error: "Unknown section." };
  try {
    await deleteDataSection(user.id, section);
  } catch {
    return { success: false, error: "Could not delete this data. Nothing was changed." };
  }
  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Full reset — wipes every piece of the signed-in user's trader-created data and
 * returns a clean default workspace, preserving their account/identity + auth.
 */
export async function resetAllDataAction(): Promise<SimpleResult> {
  const user = await requireUser();
  try {
    await resetAllData(user.id);
  } catch {
    return { success: false, error: "Reset failed. Your data was left unchanged." };
  }
  revalidatePath("/", "layout");
  return { success: true };
}
