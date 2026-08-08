import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

import { auth } from "@/server/auth";
import { utcDateToKey } from "@/lib/date";
import { getTrade } from "@/server/services/trades.service";
import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";
import {
  assertOwnsMediaTarget,
  attachMedia,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/server/services/media.service";

const f = createUploadthing();

// Must mirror the Prisma MediaOwnerType enum.
const ownerTypeSchema = z.enum([
  "TRADE",
  "DAILY_NOTE",
  "STRATEGY",
  "STRATEGY_ENTRY_MODEL",
  "STRATEGY_CHECKLIST_ITEM",
  "STRATEGY_FRAMEWORK_STEP",
  "ARSENAL_CONCEPT",
]);

/**
 * The app's universal image-upload route. Auth + ownership of the target record
 * are proven in the middleware — which runs on our server before a presigned URL
 * is ever issued — so an unauthenticated or cross-tenant request can never reach
 * storage. Server-side MIME/size validation is enforced by the `image` filter
 * (non-images and oversized files are rejected before onUploadComplete).
 * onUploadComplete then links the file to its owner via the media service.
 */
export const ourFileRouter = {
  media: f({
    image: { maxFileSize: "8MB", maxFileCount: MAX_ATTACHMENTS_PER_OWNER },
  })
    .input(
      z.object({
        ownerType: ownerTypeSchema,
        ownerId: z.string().min(1),
        category: z.string().max(40).optional(),
      }),
    )
    .middleware(async ({ input }) => {
      const session = await auth();
      if (!session?.user?.id) throw new UploadThingError("You must be signed in to upload.");

      const owns = await assertOwnsMediaTarget(session.user.id, input.ownerType, input.ownerId);
      if (!owns) throw new UploadThingError("Not found or access denied.");

      // A trade on an archived (read-only) day can't receive new uploads either.
      if (input.ownerType === "TRADE") {
        const trade = await getTrade(session.user.id, input.ownerId);
        if (trade) {
          try {
            await assertDayEditable(session.user.id, utcDateToKey(trade.tradeDate));
          } catch (e) {
            if (e instanceof DayArchivedError) throw new UploadThingError(e.message);
            throw e;
          }
        }
      }

      return {
        userId: session.user.id,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        category: input.category ?? null,
      };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await attachMedia({
        userId: metadata.userId,
        ownerType: metadata.ownerType,
        ownerId: metadata.ownerId,
        category: metadata.category,
        storageKey: file.key,
        url: file.ufsUrl,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      // Returned to the client's onClientUploadComplete callback.
      return { ownerId: metadata.ownerId, category: metadata.category };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
