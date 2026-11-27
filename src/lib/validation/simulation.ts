import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import { REPLAY_TIMEFRAMES } from "@/domain/native-replay/timeframes";

const id = z.string().min(1).max(64);
const dateKey = z.string().refine(isValidDateKey, "Use a valid YYYY-MM-DD date.");
const priceText = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a price like 1.08250.").max(24);

export const createLabAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    description: z.string().trim().max(2000).nullish(),
    strategyId: id.nullish(),
    /**
     * How the session uses a strategy (default: EXISTING when strategyId is
     * set, otherwise NONE):
     *  NONE        discretionary backtest, no structured strategy;
     *  EXISTING    backtest mode — test a Strategy Lab strategy as-is;
     *  REFINE      refinement mode — fork strategyId into a new experiment and test that;
     *  EXPERIMENT  test an existing ACTIVE experiment (experimentId);
     *  BUILD       strategy-building mode — start a blank strategy (newStrategyName).
     */
    strategyMode: z.enum(["NONE", "EXISTING", "REFINE", "EXPERIMENT", "BUILD"]).optional(),
    experimentId: id.nullish(),
    newStrategyName: z.string().trim().max(120).nullish(),
    datasets: z.array(z.object({ assetSymbol: z.string().trim().toUpperCase().min(1).max(20), datasetId: id })).min(1, "Add at least one instrument.").max(10),
    periodStart: dateKey,
    periodEnd: dateKey,
    startingBalance: z.coerce.number().positive().max(1e10),
    currency: z.string().trim().toUpperCase().length(3).default("USD"),
    commissionPerUnitPerSide: z.coerce.number().min(0).max(1e6).default(0),
    defaultSpreadPoints: z.coerce.number().int().min(0).max(100_000).default(0),
    dailyResetHour: z.coerce.number().int().min(0).max(23).default(0),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "The end date must be on or after the start date.", path: ["periodEnd"] });

export const clockCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BARS"), count: z.number().int().min(1).max(1440) }),
  z.object({ kind: z.literal("CANDLE"), timeframe: z.enum(REPLAY_TIMEFRAMES as unknown as [string, ...string[]]), count: z.number().int().min(1).max(1440).optional() }),
  z.object({ kind: z.literal("SEEK"), to: z.number().int(), align: z.enum(["AT_OR_BEFORE", "AT_OR_AFTER"]).optional(), until: z.number().int().optional() }),
  z.object({ kind: z.literal("NEXT_DAY") }),
]);

export const advanceSchema = z.object({
  accountId: id,
  command: clockCommandSchema,
  commandId: id.nullish(),
  /** Instruments on screen: their newly revealed M1 bars come back with the step. */
  views: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(4).optional(),
});

export const orderSchema = z
  .object({
    accountId: id,
    symbol: z.string().trim().toUpperCase().min(1).max(20),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT", "STOP"]),
    price: priceText.nullish(),
    stopLoss: priceText.nullish(),
    takeProfit: priceText.nullish(),
    sizing: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("QUANTITY"), quantity: z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a quantity like 0.50.") }),
      z.object({ mode: z.literal("RISK_PERCENT"), riskPercent: z.number().gt(0).max(100) }),
      z.object({ mode: z.literal("RISK_AMOUNT"), amount: z.number().gt(0).max(1e9) }),
    ]),
    expiresMinute: z.number().int().nullish(),
    clientRequestId: id.nullish(),
    note: z.string().trim().max(2000).nullish(),
    /** A position drawing this order was drafted from (checked and linked server-side). */
    drawingId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).nullish(),
    /** The trader's strategy checklist for this decision; the server scores it
     *  against the session's frozen strategy (never trusted as a result). */
    strategyCheck: z
      .object({
        setupTypeName: z.string().trim().max(120).nullish(),
        checkedNames: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
      })
      .nullish(),
  })
  .refine((v) => v.type === "MARKET" || (v.price != null && v.price !== ""), { message: "A pending order needs a price.", path: ["price"] });

export const closePositionSchema = z.object({ accountId: id, positionId: id, percent: z.number().gt(0).max(100).nullish(), commandId: id.nullish() });
export const modifyPositionSchema = z.object({ accountId: id, positionId: id, stopLoss: priceText.nullable(), takeProfit: priceText.nullable(), commandId: id.nullish() });
export const cancelOrderSchema = z.object({ accountId: id, orderId: id });
export const candlesSchema = z.object({
  accountId: id,
  symbol: z.string().trim().toUpperCase().min(1).max(20),
  timeframe: z.enum(REPLAY_TIMEFRAMES as unknown as [string, ...string[]]),
  limit: z.number().int().min(1).max(5000).nullish(),
  /** Review: show the chart as of an earlier minute (clamped to the account clock — never later). */
  asOf: z.number().int().nullish(),
  to: z.number().int().nullish(),
  from: z.number().int().nullish(),
});
export const accountRefSchema = z.object({ accountId: id });
export const labStatusSchema = z.object({ accountId: id, status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]) });

export type CreateLabAccountInput = z.infer<typeof createLabAccountSchema>;

// ── Strategy Lab studies (Phase 4) ─────────────────────────────────────────
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const tagList = z.array(z.string().trim().min(1).max(40)).max(30).default([]);

export const studySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    description: text(4000),
    hypothesis: text(2000),
    category: text(60),
    tags: tagList,
    status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
    instruments: z.array(z.string().trim().min(1).max(20)).max(30).default([]),
    timeframes: z.array(z.string().trim().min(1).max(10)).max(16).default([]),
    periodStart: dateKey.nullish(),
    periodEnd: dateKey.nullish(),
    marketConditions: text(2000),
    setupCriteria: text(4000),
    confirmationCriteria: text(4000),
    entryRules: text(4000),
    exitRules: text(4000),
    strategyId: id.nullish(),
    setups: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, { message: "The end date must be on or after the start date.", path: ["periodEnd"] });

export const observationSchema = z.object({
  studyId: id,
  setupId: id.nullish(),
  accountId: id.nullish(),
  positionId: id.nullish(),
  kind: z.enum(["TRADED", "NOT_TRADED", "MISSED"]),
  symbol: z.string().trim().toUpperCase().max(20).nullish(),
  timeframe: z.string().trim().max(10).nullish(),
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "UNRESOLVED"]).nullish(),
  selfReportedR: z.number().min(-100).max(100).nullish(),
  setupTags: tagList,
  confirmationTags: tagList,
  explanation: text(4000),
  lessons: text(4000),
  notes: text(4000),
});

export const setupSchema = z.object({ studyId: id, name: z.string().trim().min(1).max(80), description: text(1000) });
export const studyStatusSchema = z.object({ studyId: id, status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "ARCHIVED"]) });

// ── Prop Firm Simulator (Phase 5) ──────────────────────────────────────────
export const purchaseChallengeSchema = z
  .object({
    modelRef: z.string().min(1).max(80),
    accountSize: z.coerce.number().positive(),
    datasets: z.array(z.object({ assetSymbol: z.string().trim().toUpperCase().min(1).max(20), datasetId: id })).min(1, "Pick at least one instrument with data.").max(10),
    periodStart: dateKey,
    periodEnd: dateKey,
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "The end date must be on or after the start date.", path: ["periodEnd"] });

export const reviewTargetSchema = z.object({
  accountId: id,
  from: z.number().int(),
  move: z.discriminatedUnion("kind", [
    z.object({ kind: z.enum(["BACK", "FORWARD"]), timeframe: z.enum(REPLAY_TIMEFRAMES as unknown as [string, ...string[]]) }),
    z.object({ kind: z.literal("SEEK"), to: z.number().int(), align: z.enum(["AT_OR_BEFORE", "AT_OR_AFTER"]).optional(), until: z.number().int().optional() }),
  ]),
});
