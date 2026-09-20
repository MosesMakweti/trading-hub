import { prisma } from "@/server/db";
import { deleteMediaFile } from "@/lib/media-storage";
import { isR2Configured } from "@/lib/r2";
import type { MediaOwnerType } from "@prisma/client";

// Re-exported for backward compatibility (existing server-side importers) —
// the actual values live in lib/media-constants.ts, which is also safe to
// import as a VALUE from client components (this file isn't, since it pulls
// in Prisma; a client component may only ever `import type` from here).
export {
  ACCEPTED_DOCUMENT_MIME,
  ACCEPTED_IMAGE_MIME,
  MAX_ATTACHMENTS_PER_OWNER,
  MAX_FILE_SIZE,
} from "@/lib/media-constants";

/** Public (auth-scoped) URL a stored asset is served from. */
export function mediaUrl(assetId: string): string {
  return `/api/media/${assetId}`;
}

export interface MediaItemDTO {
  /** The attachment id (what you delete). */
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: string | null;
  caption: string | null;
  /** Chart timeframe (e.g. "Daily", "4H", "15M") — only meaningful for
   *  DAILY_ASSET_ANALYSIS attachments; absent/null for every other owner type.
   *  Optional so pre-existing owner-type mappings (e.g. Prop Firms documents)
   *  don't need to thread through a field that will never apply to them. */
  timeframe?: string | null;
}

/** Uploads are enabled once the R2 bucket credentials are configured. */
export function isUploadsEnabled(): boolean {
  return isR2Configured();
}

/** How many attachments an owner already has in a given category (for the cap). */
export function countMediaForOwner(
  ownerType: MediaOwnerType,
  ownerId: string,
  category: string | null,
): Promise<number> {
  return prisma.mediaAttachment.count({ where: { ownerType, ownerId, category } });
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
    case "DAILY_ASSET_ANALYSIS":
      return Boolean(
        await prisma.dailyAssetAnalysis.findFirst({
          where: { id: ownerId, userId },
          select: { id: true },
        }),
      );
    case "REPLAY_TRADE":
      // Replay foundation (Stage 12) — readiness only, no upload UI yet.
      return Boolean(
        await prisma.replayTrade.findFirst({
          where: { id: ownerId, userId },
          select: { id: true },
        }),
      );
    case "PROP_FIRM_MILESTONE":
      // ownerId is either an AccountMilestone or a Payout id — both are
      // evidence targets scoped through their PropFirmAccount's userId.
      return Boolean(
        (await prisma.accountMilestone.findFirst({
          where: { id: ownerId, account: { userId } },
          select: { id: true },
        })) ??
          (await prisma.payout.findFirst({
            where: { id: ownerId, account: { userId } },
            select: { id: true },
          })),
      );
    default: {
      // Exhaustiveness guard — a new MediaOwnerType must add a case above.
      const _never: never = ownerType;
      return _never;
    }
  }
}

/**
 * Creates the bare `MediaAsset` row for a just-saved file — no
 * `MediaAttachment`, no ownership check of any OTHER record (the caller is
 * uploading their own file; there's nothing else to authorize against at
 * this point). Two callers share this:
 *   - `attachMedia` (below), which creates one then immediately wraps it in
 *     an attachment for an existing owner record.
 *   - `createStandaloneMediaAsset` (below), for the TradingView extension's
 *     `POST /api/v1/media` (Step 8) — captured BEFORE a Trade exists, so
 *     there is no owner record to attach to yet. `attachPlanScreenshot`
 *     (trade-plan.service.ts) only ever checks `MediaAsset.userId`, never a
 *     MediaAttachment, so a standalone asset is fully usable there the
 *     moment it's created — it just won't appear in an
 *     ownerType/ownerId-based gallery query until something attaches it.
 */
async function createMediaAsset(args: {
  userId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}) {
  const asset = await prisma.mediaAsset.create({
    data: {
      userId: args.userId,
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSize: args.fileSize,
      url: mediaUrl("pending"), // replaced below once the id exists
    },
  });
  return prisma.mediaAsset.update({ where: { id: asset.id }, data: { url: mediaUrl(asset.id) } });
}

/**
 * Links a just-saved file to an owner record and returns the resulting gallery
 * item. Ownership is re-verified here (defense in depth) even though the upload
 * route already checked it. Throws if the owner isn't the user's — the caller
 * should have deleted the file it wrote.
 */
export async function attachMedia(args: {
  userId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  category: string | null;
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  caption?: string | null;
  timeframe?: string | null;
}): Promise<MediaItemDTO> {
  const owns = await assertOwnsMediaTarget(args.userId, args.ownerType, args.ownerId);
  if (!owns) throw new Error("Not found or access denied.");

  const count = await prisma.mediaAttachment.count({
    where: { ownerType: args.ownerType, ownerId: args.ownerId, category: args.category },
  });

  const asset = await createMediaAsset(args);

  const attachment = await prisma.mediaAttachment.create({
    data: {
      mediaId: asset.id,
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      category: args.category,
      caption: args.caption ?? null,
      timeframe: args.timeframe ?? null,
      sortOrder: count,
    },
  });

  return {
    id: attachment.id,
    url: asset.url,
    fileName: args.fileName,
    mimeType: args.mimeType,
    fileSize: args.fileSize,
    category: args.category,
    caption: attachment.caption,
    timeframe: attachment.timeframe,
  };
}

export interface StandaloneMediaDTO {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

/**
 * TradingView Extension — Step 8. Creates a MediaAsset with no owner
 * attachment yet, for a caller that doesn't have (or doesn't yet want to
 * commit to) an owner record — specifically, `POST /api/v1/media`, called
 * BEFORE the Trade it will eventually belong to exists (§15: capture is
 * decoupled from trade creation on purpose). The returned id is a fully
 * valid `mediaAssetId` for `POST /api/v1/trades`, which resolves it via
 * `attachPlanScreenshot` — itself unmodified, and itself never requiring a
 * MediaAttachment (see createMediaAsset's doc comment above).
 *
 * KNOWN LIMITATION (documented, not a bug): because no MediaAttachment is
 * created here, an asset uploaded this way will NOT appear in a
 * MediaAttachment-based gallery (e.g. the Trades Album's before-trade photo
 * list) unless/until something later attaches it that way. It DOES render
 * correctly anywhere the canonical TradePlanScreenshot relation is used
 * directly (the Trade Workspace's own plan view), and it IS served
 * correctly by the existing auth-scoped `GET /api/media/[id]` route (which
 * looks up by `MediaAsset.id` + `userId` only, never a MediaAttachment).
 */
export async function createStandaloneMediaAsset(args: {
  userId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<StandaloneMediaDTO> {
  const asset = await createMediaAsset(args);
  return { id: asset.id, url: asset.url, fileName: asset.fileName, mimeType: asset.mimeType, fileSize: asset.fileSize };
}

export type StandaloneDeleteFailureReason = "not_found" | "attached";

export interface StandaloneDeleteResult {
  ok: boolean;
  reason?: StandaloneDeleteFailureReason;
}

/**
 * TradingView Extension — Step 9, Part 9. Deletes a MediaAsset ONLY when it
 * is genuinely a standalone, unused orphan — never one already in use.
 * "In use" means either:
 *   - it has ANY `MediaAttachment` row (the web app's normal gallery link), or
 *   - it's referenced by ANY `TradePlanScreenshot`, as either the original
 *     `mediaAssetId` or the annotated `previewMediaAssetId`.
 * Either condition blocks deletion outright — this function has no
 * "detach first" behavior; a screenshot already wrapped into a canonical
 * Trade Plan is never touched, full stop. Scoped to `userId` throughout, so
 * a caller can only ever delete their OWN unattached uploads (never another
 * user's media, attached or not).
 *
 * This is the exact case Step 8 left as a known, accepted orphan: a
 * Retake/Remove after upload, or an abandoned Trade Idea, leaves a bare
 * `MediaAsset` nothing else references. This function is the smallest safe
 * way to actually clean one up, reusing the existing `deleteMediaFile`
 * (same R2 call `deleteMediaAttachment` below already uses) — no new
 * storage/deletion mechanism.
 */
export async function deleteStandaloneMediaAsset(userId: string, mediaAssetId: string): Promise<StandaloneDeleteResult> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, userId }, select: { id: true, storageKey: true } });
  if (!asset) return { ok: false, reason: "not_found" };

  const [attachmentCount, screenshotCount] = await Promise.all([
    prisma.mediaAttachment.count({ where: { mediaId: asset.id } }),
    prisma.tradePlanScreenshot.count({ where: { OR: [{ mediaAssetId: asset.id }, { previewMediaAssetId: asset.id }] } }),
  ]);
  if (attachmentCount > 0 || screenshotCount > 0) return { ok: false, reason: "attached" };

  await deleteMediaFile(asset.storageKey);
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  return { ok: true };
}

export async function updateMediaCaption(userId: string, attachmentId: string, caption: string | null) {
  const attachment = await prisma.mediaAttachment.findFirst({
    where: { id: attachmentId, media: { userId } },
    select: { id: true },
  });
  if (!attachment) throw new Error("Media not found.");
  return prisma.mediaAttachment.update({ where: { id: attachmentId }, data: { caption } });
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
    caption: a.caption,
    timeframe: a.timeframe,
  }));
}

/**
 * Batched preview lookup for the trade gallery: one representative image URL per
 * trade (a Before-Trade screenshot if present, else the first), in a single query —
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
    const before = list.find((i) => i.category === "BEFORE");
    previews.set(tradeId, (before ?? list[0]).url);
  }
  return previews;
}

/**
 * Batched full-gallery lookup for the Trades Album: every image for every given
 * trade (not just one preview), in a single query — scoped to the user via the
 * asset. Ordered Before-Trade first then After-Trade (an Entry -> Exit review
 * flow), preserving upload order within each category.
 */
export async function listTradeMediaForTrades(
  userId: string,
  tradeIds: string[],
): Promise<Map<string, MediaItemDTO[]>> {
  if (tradeIds.length === 0) return new Map();
  const attachments = await prisma.mediaAttachment.findMany({
    where: { ownerType: "TRADE", ownerId: { in: tradeIds }, media: { userId } },
    include: { media: true },
    orderBy: { sortOrder: "asc" },
  });

  const categoryRank = (category: string | null) =>
    category === "BEFORE" ? 0 : category === "AFTER" ? 1 : 2;

  const byTrade = new Map<string, MediaItemDTO[]>();
  for (const a of attachments) {
    const list = byTrade.get(a.ownerId) ?? [];
    list.push({
      id: a.id,
      url: a.media.url,
      fileName: a.media.fileName,
      mimeType: a.media.mimeType,
      fileSize: a.media.fileSize,
      category: a.category,
      caption: a.caption,
      timeframe: a.timeframe,
    });
    byTrade.set(a.ownerId, list);
  }
  for (const list of byTrade.values()) {
    list.sort((x, y) => categoryRank(x.category) - categoryRank(y.category));
  }
  return byTrade;
}

/**
 * Generic batched lookup — every attachment for many owners of the SAME
 * ownerType, in one query, grouped by ownerId. Used by the Prop Firms
 * milestone/payout evidence lists (each milestone/payout is its own owner).
 */
export async function listMediaForOwners(
  userId: string,
  ownerType: MediaOwnerType,
  ownerIds: string[],
): Promise<Map<string, MediaItemDTO[]>> {
  if (ownerIds.length === 0) return new Map();
  const attachments = await prisma.mediaAttachment.findMany({
    where: { ownerType, ownerId: { in: ownerIds }, media: { userId } },
    include: { media: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
  const byOwner = new Map<string, MediaItemDTO[]>();
  for (const a of attachments) {
    const list = byOwner.get(a.ownerId) ?? [];
    list.push({
      id: a.id,
      url: a.media.url,
      fileName: a.media.fileName,
      mimeType: a.media.mimeType,
      fileSize: a.media.fileSize,
      category: a.category,
      caption: a.caption,
      timeframe: a.timeframe,
    });
    byOwner.set(a.ownerId, list);
  }
  return byOwner;
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

  await deleteMediaFile(attachment.media.storageKey);
  // Deleting the asset cascades the attachment row (1 asset : 1 attachment here).
  await prisma.mediaAsset.delete({ where: { id: attachment.media.id } });

  return { ownerType: attachment.ownerType, ownerId: attachment.ownerId };
}
