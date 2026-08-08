"use server";

import { requireUser } from "@/server/guards";
import {
  deleteMediaAttachment,
  isUploadsEnabled,
  listMedia,
  type MediaItemDTO,
} from "@/server/services/media.service";
import type { MediaOwnerType } from "@prisma/client";

type SimpleResult = { success: true } | { success: false; error: string };

/**
 * Loads the media attached to one owner (scoped to the signed-in user) plus
 * whether uploads are configured. Lets the reusable <ImageAttachments> component
 * fetch its own data on mount, so wiring it anywhere is a one-liner — no page-level
 * data plumbing. Returns an empty list on any failure rather than throwing.
 */
export async function loadMediaAction(
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<{ uploadsEnabled: boolean; items: MediaItemDTO[] }> {
  const uploadsEnabled = isUploadsEnabled();
  try {
    const user = await requireUser();
    const items = await listMedia(user.id, ownerType, ownerId);
    return { uploadsEnabled, items };
  } catch {
    return { uploadsEnabled, items: [] };
  }
}

/**
 * Deletes one attachment (hosted file + record). Scoped to the user through the
 * asset's owner, so a user can only delete their own media. Uploads themselves go
 * straight to UploadThing via the FileRouter — this action only covers deletion.
 */
export async function deleteMediaAction(attachmentId: string): Promise<SimpleResult> {
  const user = await requireUser();
  try {
    await deleteMediaAttachment(user.id, attachmentId);
  } catch {
    return { success: false, error: "Could not delete image." };
  }
  return { success: true };
}
