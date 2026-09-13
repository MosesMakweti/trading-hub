import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import { validateReviewPeriod } from "@/domain/replay/review-period";
import { setupOverrideReasonSchema } from "@/lib/validation/trades";

const dateKey = z.string().refine(isValidDateKey, { message: "Invalid date." });
const assetSymbolSchema = z.string().trim().min(1).max(20).transform((s) => s.toUpperCase());

export const createReplayReviewSessionSchema = z
  .object({
    reviewType: z.enum(["WEEKLY", "MONTHLY"]),
    startDate: dateKey,
    endDate: dateKey,
    strategyId: z.string().min(1).nullable().optional(),
    assetSymbols: z.array(assetSymbolSchema).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    const result = validateReviewPeriod(data.reviewType, data.startDate, data.endDate);
    if (!result.valid) {
      ctx.addIssue({ code: "custom", message: result.error ?? "Invalid review period.", path: ["endDate"] });
    }
  });

/** Stage 12.5 §7 — "Start Replay Review" from inside Edge Review. Same shape
 *  as creation (minus the DRAFT-vs-started distinction, which the action
 *  handles: find-or-create, then immediately start). */
export const startReplayReviewForPeriodSchema = createReplayReviewSessionSchema;

export const updateReplayReviewNotesSchema = z.object({
  notes: z.unknown(),
});

const targetInputSchema = z.object({
  price: z.number(),
  percentToClose: z.number().min(0).max(100),
});

/**
 * Creates a Replay decision (Stage 14 §2/§27) — covers BOTH SKIPPED (no
 * order fields needed) and TAKEN (order fields required) in one shape, since
 * a decision always captures the same context (asset/direction/strategy/
 * setup/validation) regardless of what the trader ultimately does with it.
 * `historicalTimestamp` is always `replayCurrentTime`, never trader-typed
 * (§24) — enforced by the service layer reading it from the clock, not from
 * free client input beyond this numeric ms value the client's OWN clock
 * state produced.
 *
 * Validation authority mirrors the real Trade save path
 * (buildSetupValidation in trades.service.ts): the client sends WHICH
 * conditions it checked (`selectedConditionIds`, by checklistItemId) and an
 * optional override request; the server resolves the HISTORICALLY-valid
 * scenario/conditions (never the live Strategy Lab config) and computes
 * `validationState`/score authoritatively — a client cannot force VALIDATED
 * by sending a snapshot directly.
 */
export const createReplayDecisionSchema = z
  .object({
    historicalTimestamp: z.number().int().nonnegative(),
    assetSymbol: assetSymbolSchema,
    direction: z.enum(["LONG", "SHORT"]),
    decisionType: z.enum(["TAKEN", "SKIPPED"]),
    strategyId: z.string().min(1).nullable().optional(),
    setupTypeName: z.string().trim().max(80).nullable().optional(),
    selectedConditionIds: z.array(z.string()).max(200).default([]),
    overrideReason: setupOverrideReasonSchema.nullable().optional(),
    overrideNote: z.string().trim().max(1000).nullable().optional(),
    notes: z.unknown().optional(),
    // TAKEN-only:
    orderType: z.enum(["MARKET", "PENDING"]).optional(),
    entryPrice: z.number().optional(),
    initialStopLoss: z.number().optional(),
    targets: z.array(targetInputSchema).max(5).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decisionType !== "TAKEN") return;
    if (data.orderType == null) ctx.addIssue({ code: "custom", message: "Order type is required.", path: ["orderType"] });
    if (data.entryPrice == null) ctx.addIssue({ code: "custom", message: "Entry price is required.", path: ["entryPrice"] });
    if (data.initialStopLoss == null) ctx.addIssue({ code: "custom", message: "Stop loss is required.", path: ["initialStopLoss"] });
  });

export const moveReplayStopLossSchema = z.object({
  newStopLoss: z.number(),
  timestamp: z.number().int().nonnegative(),
});

export const closeReplayPartialSchema = z.object({
  percent: z.number().min(0).max(100),
  price: z.number(),
  timestamp: z.number().int().nonnegative(),
});

export const closeReplayRemainingSchema = z.object({
  price: z.number(),
  timestamp: z.number().int().nonnegative(),
});

export const cancelReplayPendingSchema = z.object({
  timestamp: z.number().int().nonnegative(),
});

export const resolveReplayAmbiguitySchema = z.object({
  resolution: z.enum(["SL_FIRST", "TARGET_FIRST"]),
});

const candleInputSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nullable(),
});

export const advanceReplayExecutionSchema = z.object({
  candles: z.array(candleInputSchema).max(3000),
});

/** Manual match correction (Stage 15.1 §16, UI wired Stage 15.2 §2). */
export const createManualComparisonLinkSchema = z.object({
  actualTradeId: z.string().min(1),
  replayTradeId: z.string().min(1),
  linkType: z.enum(["MATCHED", "EXCLUDED"]),
});

/** Remove/reset a manual match correction, by the pair it links. */
export const deleteManualComparisonLinkSchema = z.object({
  actualTradeId: z.string().min(1),
  replayTradeId: z.string().min(1),
});

/** Confirm/reject a Potential Missed Opportunity (Stage 15.2 §5). */
export const setMissedOpportunityClassificationSchema = z.object({
  replayTradeId: z.string().min(1),
  classification: z.enum(["CONFIRMED_MISSED", "NOT_MISSED"]),
});

/** Replay Clock resume checkpoint (Stage 13 §10). */
export const updateReplayProgressSchema = z.object({
  currentTime: z.number().int().positive(),
  asset: assetSymbolSchema,
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1D"]),
});

/** Fetching a chunk of historical candles for the Replay chart (Stage 13 §8,
 *  extended Stage 17B §13 — `sessionId` is required so market-data
 *  provenance can be frozen/enforced per session). */
export const getReplayCandlesSchema = z.object({
  sessionId: z.string().min(1),
  canonicalSymbol: assetSymbolSchema,
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
});

const replayTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1D"]);

/**
 * Stage 18 §18 — geometry is validated AT THE BOUNDARY, per `type`, via a
 * discriminated union — never trusted as opaque JSON. `time` values are UTC
 * epoch ms (matching `Candle.timestamp`'s own convention throughout this
 * app), not a trader-typed date string.
 */
const annotationPointSchema = z.object({ time: z.number().int().nonnegative(), price: z.number() });
const horizontalLineGeometrySchema = z.object({ price: z.number() });
const twoPointGeometrySchema = z.object({ p1: annotationPointSchema, p2: annotationPointSchema });

const annotationCommonFields = {
  sessionId: z.string().min(1),
  assetSymbol: assetSymbolSchema,
  timeframe: replayTimeframeSchema.nullable().optional(),
};

export const createReplayAnnotationSchema = z.discriminatedUnion("type", [
  z.object({ ...annotationCommonFields, type: z.literal("HORIZONTAL_LINE"), geometry: horizontalLineGeometrySchema, text: z.string().trim().max(500).nullable().optional() }),
  z.object({ ...annotationCommonFields, type: z.literal("TREND_LINE"), geometry: twoPointGeometrySchema, text: z.string().trim().max(500).nullable().optional() }),
  z.object({ ...annotationCommonFields, type: z.literal("RECTANGLE"), geometry: twoPointGeometrySchema, text: z.string().trim().max(500).nullable().optional() }),
  z.object({ ...annotationCommonFields, type: z.literal("TEXT"), geometry: annotationPointSchema, text: z.string().trim().min(1).max(500) }),
]);

export const deleteReplayAnnotationSchema = z.object({ id: z.string().min(1) });

export const clearReplayAnnotationsSchema = z.object({
  sessionId: z.string().min(1),
  assetSymbol: assetSymbolSchema,
});

/** Stage 18 §19 — lightweight reasoning notes on a `ReplayTrade`, reusing
 *  its existing `notes: Json?` field (already used for `skipReason`) rather
 *  than a new column/model — the service layer merges `{reasoning: note}`
 *  into that JSON object, never clobbering a `skipReason` key written by a
 *  different flow. */
export const updateReplayTradeReasoningNoteSchema = z.object({
  note: z.string().trim().max(2000),
});

export type CreateReplayReviewSessionInput = z.infer<typeof createReplayReviewSessionSchema>;
export type CreateReplayDecisionInput = z.infer<typeof createReplayDecisionSchema>;
export type MoveReplayStopLossInput = z.infer<typeof moveReplayStopLossSchema>;
export type CloseReplayPartialInput = z.infer<typeof closeReplayPartialSchema>;
export type CloseReplayRemainingInput = z.infer<typeof closeReplayRemainingSchema>;
export type CancelReplayPendingInput = z.infer<typeof cancelReplayPendingSchema>;
export type ResolveReplayAmbiguityInput = z.infer<typeof resolveReplayAmbiguitySchema>;
export type AdvanceReplayExecutionInput = z.infer<typeof advanceReplayExecutionSchema>;
export type CreateReplayAnnotationInput = z.infer<typeof createReplayAnnotationSchema>;
