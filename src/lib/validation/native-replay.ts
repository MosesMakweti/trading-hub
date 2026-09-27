import { z } from "zod";

import { REPLAY_TIMEFRAMES } from "@/domain/native-replay/timeframes";
import { DRAWING_TYPES, MAX_TARGETS, MAX_TEXT_LENGTH } from "@/domain/native-replay/drawings/model";
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

/** The run's clock for one simulation date (shared by all its assets). */
export const replayClockSchema = z.object({ runId: id, dateKey });

export const replayCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BARS"), count: z.number().int().min(1).max(1440) }),
  z.object({ kind: z.literal("CANDLE"), timeframe: z.enum(REPLAY_TIMEFRAMES) }),
  z.object({ kind: z.literal("SEEK"), to: wallClock }),
]);

export const advanceReplaySchema = replayClockSchema.extend({
  command: replayCommandSchema,
  /** Client-generated per command; a retried request with the same id is not applied twice. */
  commandId: z.string().trim().min(8).max(64),
  /** The asset on screen — its newly revealed M1 bars come back for the chart. */
  viewAsset: symbol.optional(),
});

/** Timeframe and window only — deliberately no cutoff: it always comes from the stored replay position. */
export const replayCandlesSchema = replayClockSchema.extend({
  assetSymbol: symbol,
  timeframe: z.enum(REPLAY_TIMEFRAMES),
  limit: z.number().int().min(1).max(5000).optional(),
  to: wallClock.optional(),
});

const anchor = z.object({ time: z.number().int(), price: z.number().finite().positive() });

/** Shape only — the domain's validateDrawing() then checks per-type rules on the server. */
export const drawingSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  type: z.enum(DRAWING_TYPES),
  assetSymbol: symbol,
  anchors: z.array(anchor).min(1).max(3),
  style: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), dash: z.enum(["solid", "dashed", "dotted"]), opacity: z.number().min(0.1).max(1) }),
  data: z.object({
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    levels: z.array(z.number().finite()).max(20).optional(),
    position: z.object({ entry: z.number().positive(), stop: z.number().positive(), targets: z.array(z.number().positive()).min(1).max(MAX_TARGETS) }).optional(),
  }),
  locked: z.boolean(),
  hidden: z.boolean(),
});

export const saveDrawingSchema = z.object({ runId: id, drawing: drawingSchema });
export const drawingRefSchema = z.object({ runId: id, assetSymbol: symbol, drawingId: z.string().min(1).max(64) });
export const listDrawingsSchema = z.object({ runId: id, assetSymbol: symbol });
export const linkDrawingSchema = drawingRefSchema.extend({ tradeId: id });
