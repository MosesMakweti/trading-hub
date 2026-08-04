"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { deleteTradeImage } from "@/server/services/trade-images.service";

type SimpleResult = { success: true } | { success: false; error: string };

/**
 * Removes a trade screenshot (hosted file + row). Uploads themselves go straight
 * to UploadThing via the FileRouter — this action only covers deletion, which
 * needs our own ownership check and cache revalidation.
 */
export async function deleteTradeImageAction(dateKey: string, imageId: string): Promise<SimpleResult> {
  const user = await requireUser();
  let tradeId: string;
  try {
    ({ tradeId } = await deleteTradeImage(user.id, imageId));
  } catch {
    return { success: false, error: "Could not delete image." };
  }
  revalidatePath(`/journal/${dateKey}/trades/${tradeId}`);
  revalidatePath(`/journal/${dateKey}`);
  return { success: true };
}
