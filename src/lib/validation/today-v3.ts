import { z } from "zod";

import { directionSchema, preTradeMoodTagSchema, setupOverrideReasonSchema } from "@/lib/validation/trades";
import { PRE_TRADE_MOOD_MAX_INTENSITY, PRE_TRADE_MOOD_MIN_INTENSITY } from "@/domain/psychology/pre-trade-mood";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

const minutes = z.coerce.number().int().min(0).max(1439);
const price = z.coerce.number().finite();

/** Today V3 Quick Trade Idea. Direction is REQUIRED and explicit — never a
 *  default. No execution time, HTF bias or confidence: those are server-side
 *  compatibility values (domain/today/idea-inheritance.ts). */
export const quickIdeaSchema = z.object({
  assetSymbol: z.string().trim().min(1, "Choose the asset.").transform((v) => v.toUpperCase()),
  strategyId: z.string().nullable().default(null),
  direction: directionSchema,
  selectedSession: z.string().trim().min(1).nullable().default(null),
  setupTypeId: z.string().nullable().default(null),
  selectedSetupConditions: z.array(z.string()).default([]),
  setupOverrideReason: setupOverrideReasonSchema.nullable().default(null),
  setupOverrideNote: optionalText(1000),
  selectedEntryModel: z.string().nullable().default(null),
  selectedConfluences: z.array(z.string()).default([]),
  reasonForTrade: optionalText(4000),
  preTradeMoodTags: z.array(preTradeMoodTagSchema).default([]),
  preTradeMoodIntensity: z.coerce
    .number()
    .int()
    .min(PRE_TRADE_MOOD_MIN_INTENSITY)
    .max(PRE_TRADE_MOOD_MAX_INTENSITY)
    .nullable()
    .default(null),
  preTradeMoodNote: optionalText(500),
  /** The trader's local clock at creation — the PROVISIONAL executionMinutes. */
  nowMinutes: minutes,
  limitOverrideReason: optionalText(1000),
  opportunityId: z.string().optional(),
});
export type QuickIdeaInput = z.infer<typeof quickIdeaSchema>;

/** Before-entry idea edits (any subset). */
export const ideaUpdateSchema = quickIdeaSchema
  .pick({
    strategyId: true,
    direction: true,
    selectedSession: true,
    setupTypeId: true,
    selectedSetupConditions: true,
    setupOverrideReason: true,
    setupOverrideNote: true,
    selectedEntryModel: true,
    selectedConfluences: true,
    reasonForTrade: true,
    preTradeMoodTags: true,
    preTradeMoodIntensity: true,
    preTradeMoodNote: true,
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });
export type IdeaUpdateInput = z.infer<typeof ideaUpdateSchema>;

/** The first actual entry, recorded from Today V3 Execution. */
export const recordEntrySchema = z.object({
  actualEntry: price,
  entryMinutes: minutes,
  actualStopLoss: price.nullable().default(null),
  limitOverrideReason: optionalText(1000),
});
export type RecordEntryInput = z.infer<typeof recordEntrySchema>;

export const entryTimeSchema = z.object({ entryMinutes: minutes });
export const executionConfirmationsSchema = z.object({ selected: z.array(z.string()).max(200) });
