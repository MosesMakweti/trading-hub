import { UTApi } from "uploadthing/server";

import { prisma } from "@/server/db";
import type { MediaOwnerType } from "@prisma/client";

/** Per-owner (and per-category) attachment cap, so no single record grows an
 * unbounded gallery. Mirrored in the FileRouter's maxFileCount. */
export const MAX_ATTACHMENTS_PER_OWNER = 12;

/** The browser-safe image formats we accept (validated server-side by the
 * FileRouter's `image` filter; listed here for the client `accept` + messaging). */
export const ACCEPTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
] as const;

export interface MediaItemDTO {
  /** The attachment id (what you delete). */
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: string | null;
}

/** True when image hosting (UploadThing) is configured for this deployment. */
export function isUploadsEnabled(): boolean {
  return Boolean(process.env.UPLOADTHING_TOKEN);
}

/**
 * The single authorization gate for the universal media system: does `userId`
 * own the record identified by (ownerType, ownerId)? Every owner type resolves
 * to a user — directly (Trade/DailyNote/Strategy/ChecklistItem) or through its
 * parent Strategy (EntryModel/FrameworkStep/ArsenalConcept). A new attachable
 * surface adds one case here and one enum value; nothing else changes.
 */
export async function assertOwnsMediaTarget(
  userId: string,
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<boolean> {
  switch (ownerType) {
    case "TRADE":
      return Boolean(
        await prisma.trade.findFirst({ where: { id: ownerId, userId }, select: { id: true } }),
      );
    case "DAILY_NOTE":
      return Boolean(
        await prisma.dailyNote.findFirst({ where: { id: ownerId, userId }, select: { id: true } }),
      );
    case "STRATEGY":
      return Boolean(
        await prisma.strategy.findFirst({ where: { id: ownerId, userId }, select: { id: true } }),
      );
    case "STRATEGY_CHECKLIST_ITEM":
      return Boolean(
        await prisma.strategyChecklistItem.findFirst({
          where: { id: ownerId, userId },
          select: { id: true },
        }),
      );
    case "STRATEGY_ENTRY_MODEL":
      return Boolean(
        await prisma.strategyEntryModel.findFirst({
          where: { id: ownerId, strategy: { userId } },
          select: { id: true },
        }),
      );
    case "STRATEGY_FRAMEWORK_STEP":
      return Boolean(
        await prisma.strategyFrameworkStep.findFirst({
          where: { id: ownerId, strategy: { userId } },
          select: { id: true },
        }),
      );
    case "ARSENAL_CONCEPT":
      return Boolean(
        await prisma.arsenalConcept.findFirst({
          where: { id: ownerId, strategy: { userId } },
          select: { id: true },
        }),
      );
    default: {
      // Exhaustiveness guard — a new MediaOwnerType must add a case above.
      const _never: never = ownerType;
      return _never;
    }
  }
}

/**
 * Links an already-uploaded file (in UploadThing) to an owner record. Called from
 * the FileRouter's server-trusted onUploadComplete; we re-verify ownership here as
 * defense in depth and skip (rather than orphan) if the owner vanished mid-upload.
 */
export async function attachMedia(args: {
  userId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  category: string | null;
  storageKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<void> {
  const owns = await assertOwnsMediaTarget(args.userId, args.ownerType, args.ownerId);
  if (!owns) return;

  const count = await prisma.mediaAttachment.count({
    where: { ownerType: args.ownerType, ownerId: args.ownerId, category: args.category },
  });

  const asset = await prisma.mediaAsset.create({
    data: {
      userId: args.userId,
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSize: args.fileSize,
      url: args.url,
    },
  });

  await prisma.mediaAttachment.create({
    data: {
      mediaId: asset.id,
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      category: args.category,
      sortOrder: count,
    },
  });
}

/**
 * Lists the media attached to one owner — scoped to the user through the asset
 * (`media.userId`), so a caller only ever sees their own uploads. Ordered by
 * category then sortOrder for stable galleries.
 */
export async function listMedia(
  userId: string,
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<MediaItemDTO[]> {
  const attachments = await prisma.mediaAttachment.findMany({
    where: { ownerType, ownerId, media: { userId } },
    include: { media: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  return attachments.map((a) => ({
    id: a.id,
    url: a.media.url,
    fileName: a.media.fileName,
    mimeType: a.media.mimeType,
    fileSize: a.media.fileSize,
    category: a.category,
  }));
}

/**
 * Batched preview lookup for the trade gallery: one representative image URL per
 * trade (the ANALYSIS screenshot if present, else the first), in a single query —
 * so the gallery never fires N per-trade requests. Scoped to the user via the asset.
 */
export async function listTradePreviewImages(
  userId: string,
  tradeIds: string[],
): Promise<Map<string, string>> {
  if (tradeIds.length === 0) return new Map();
  const rows = await prisma.mediaAttachment.findMany({
    where: { ownerType: "TRADE", ownerId: { in: tradeIds }, media: { userId } },
    include: { media: { select: { url: true } } },
    orderBy: { sortOrder: "asc" },
  });
  const byTrade = new Map<string, { category: string | null; url: string }[]>();
  for (const row of rows) {
    const list = byTrade.get(row.ownerId) ?? [];
    list.push({ category: row.category, url: row.media.url });
    byTrade.set(row.ownerId, list);
  }
  const previews = new Map<string, string>();
  for (const [tradeId, list] of byTrade) {
    const analysis = list.find((i) => i.category === "ANALYSIS");
    previews.set(tradeId, (analysis ?? list[0]).url);
  }
  return previews;
}

/**
 * Deletes one attachment the user owns — the hosted file first (so we never leave
 * a dangling reference), then the asset (which cascades the attachment). Scoped
 * through `media.userId`, so a user can only ever delete their own media. Returns
 * the owner it was attached to, for cache revalidation.
 */
export async function deleteMediaAttachment(
  userId: string,
  attachmentId: string,
): Promise<{ ownerType: MediaOwnerType; ownerId: string }> {
  const attachment = await prisma.mediaAttachment.findFirst({
    where: { id: attachmentId, media: { userId } },
    include: { media: { select: { id: true, storageKey: true } } },
  });
  if (!attachment) throw new Error("Media not found.");

  await new UTApi().deleteFiles([attachment.media.storageKey]);
  // Deleting the asset cascades the attachment row (1 asset : 1 attachment here).
  await prisma.mediaAsset.delete({ where: { id: attachment.media.id } });

  return { ownerType: attachment.ownerType, ownerId: attachment.ownerId };
}
