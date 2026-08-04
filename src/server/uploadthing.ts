import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

import { auth } from "@/server/auth";
import { utcDateToKey } from "@/lib/date";
import { getTrade } from "@/server/services/trades.service";
import { assertDayEditable, DayArchivedError } from "@/server/services/trading-day.service";
import { attachTradeImage, MAX_IMAGES_PER_CATEGORY } from "@/server/services/trade-images.service";

const f = createUploadthing();

/**
 * The app's only upload route: trade screenshots, bucketed by category. Auth and
 * trade-ownership are proven in the middleware (which runs on our server before a
 * presigned URL is ever issued), so an unauthenticated or cross-tenant request
 * can never reach storage. onUploadComplete then links the file to the trade.
 */
export const ourFileRouter = {
  tradeImage: f({
    image: { maxFileSize: "8MB", maxFileCount: MAX_IMAGES_PER_CATEGORY },
  })
    .input(
      z.object({
        tradeId: z.string().min(1),
        category: z.enum(["ANALYSIS", "BEFORE", "AFTER"]),
      }),
    )
    .middleware(async ({ input }) => {
      const session = await auth();
      if (!session?.user?.id) throw new UploadThingError("You must be signed in to upload.");

      const trade = await getTrade(session.user.id, input.tradeId);
      if (!trade) throw new UploadThingError("Trade not found.");

      // An archived day is read-only — block new uploads to it too.
      try {
        await assertDayEditable(session.user.id, utcDateToKey(trade.tradeDate));
      } catch (e) {
        if (e instanceof DayArchivedError) throw new UploadThingError(e.message);
        throw e;
      }

      return { userId: session.user.id, tradeId: input.tradeId, category: input.category };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await attachTradeImage({
        userId: metadata.userId,
        tradeId: metadata.tradeId,
        category: metadata.category,
        url: file.ufsUrl,
        uploadthingKey: file.key,
      });
      // Returned to the client's onClientUploadComplete callback.
      return { category: metadata.category };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
