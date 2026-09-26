import { z } from "zod";

import { REPLAY_TIMEFRAMES } from "@/domain/native-replay/timeframes";
import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { isValidDateKey } from "@/lib/date";

const dateKey = z.string().refine(isValidDateKey, "Invalid date.");
const id = z.string().trim().min(1).max(64);
const symbol = z.string().trim().min(1).max(32);

/** A wall-clock time on the dataset's clock ("YYYY-MM-DDTHH:mm", no offset). */
const wallClock = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const minute = parseWallClock(value);
    if (minute == null) {
      ctx.addIssue({ code: "custom", message: "Invalid time — use YYYY-MM-DDTHH:mm (dataset/server time)." });
      return z.NEVER;
    }
    return minute;
  });

export const createImportUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  symbol: symbol.optional().nullable(),
});

export const processImportUploadSchema = z.object({
  uploadId: id,
  symbol: symbol.optional().nullable(),
  utcOffsetMinutes: z.number().int().min(-720).max(840).optional().nullable(),
});

export const datasetPinSchema = z.object({ runId: id, assetSymbol: symbol, datasetId: id });
export const datasetUnpinSchema = z.object({ runId: id, assetSymbol: symbol });

export const replayRefSchema = z.object({ runId: id, dateKey, assetSymbol: symbol });

export const replayCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BARS"), count: z.number().int().min(1).max(1440) }),
  z.object({ kind: z.literal("CANDLE"), timeframe: z.enum(REPLAY_TIMEFRAMES) }),
  z.object({ kind: z.literal("SEEK"), to: wallClock }),
]);

export const advanceReplaySchema = replayRefSchema.extend({
  command: replayCommandSchema,
  /** Client-generated per command; a retried request with the same id is not applied twice. */
  commandId: z.string().trim().min(8).max(64),
});

/** Timeframe and window only — deliberately no cutoff: it always comes from the stored replay position. */
export const replayCandlesSchema = replayRefSchema.extend({
  timeframe: z.enum(REPLAY_TIMEFRAMES),
  limit: z.number().int().min(1).max(5000).optional(),
  to: wallClock.optional(),
});
