import { UTApi } from "uploadthing/server";

import { prisma } from "@/server/db";
import type { ImageCategory } from "@prisma/client";

// Cap per category so a single trade can't accumulate an unbounded gallery; also
// mirrored in the FileRouter's maxFileCount so the client is bounded before upload.
export const MAX_IMAGES_PER_CATEGORY = 6;

/**
 * Links an already-uploaded file to a trade. Called from the UploadThing
 * onUploadComplete callback (server-trusted), so ownership was already proven in
 * the router middleware — we re-scope by userId here anyway as defense in depth.
 * If the trade no longer belongs to the user (deleted mid-upload), we skip the
 * insert rather than orphan a row against someone else's trade.
 */
export async function attachTradeImage(args: {
  userId: string;
  tradeId: string;
  category: ImageCategory;
  url: string;
  uploadthingKey: string;
}): Promise<void> {
  const trade = await prisma.trade.findFirst({
    where: { id: args.tradeId, userId: args.userId },
    select: { id: true },
  });
  if (!trade) return;

  const count = await prisma.tradeImage.count({
    where: { tradeId: args.tradeId, category: args.category },
  });

  await prisma.tradeImage.create({
    data: {
      tradeId: args.tradeId,
      category: args.category,
      url: args.url,
      uploadthingKey: args.uploadthingKey,
      sortOrder: count,
    },
  });
}

/**
 * Deletes a trade image the user owns — both the UploadThing-hosted file and the
 * row. Scoped through the image's parent trade so a user can only ever delete
 * their own attachments. Returns the parent tradeId for cache revalidation.
 */
export async function deleteTradeImage(userId: string, imageId: string): Promise<{ tradeId: string }> {
  const image = await prisma.tradeImage.findFirst({
    where: { id: imageId, trade: { userId } },
    select: { id: true, tradeId: true, uploadthingKey: true },
  });
  if (!image) throw new Error("Image not found.");

  // Remove the hosted file first; if this throws we keep the row so we never
  // leave a dangling reference to a file that still exists in storage.
  await new UTApi().deleteFiles([image.uploadthingKey]);
  await prisma.tradeImage.delete({ where: { id: image.id } });

  return { tradeId: image.tradeId };
}
