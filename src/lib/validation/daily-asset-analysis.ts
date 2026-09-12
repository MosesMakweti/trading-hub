import { z } from "zod";

import { dayBiasSchema } from "@/lib/validation/today";

/** Tiptap documents are arbitrary JSON; structure is enforced by the editor. */
const richText = z.unknown().nullable();

/** BULLISH | BEARISH | NEUTRAL — the SAME tri-state vocabulary TradingDay.bias
 *  already uses for a market read (technical/fundamental), reused here so a
 *  trader is never forced to reconcile htf/session/fundamental bias with each
 *  other or with the final trading decision below. */
export const marketBiasSchema = dayBiasSchema;

/** LONG | SHORT | NEUTRAL — a DIFFERENT vocabulary from marketBiasSchema:
 *  this is the trader's trading decision, never derived from the biases
 *  above. NEUTRAL is always a valid, first-class conclusion (no setup yet). */
export const finalBiasSchema = z.enum(["LONG", "SHORT", "NEUTRAL"]);

const assetSymbol = z
  .string()
  .trim()
  .min(1, "Asset symbol is required.")
  .max(20, "Asset symbol is too long.");

export const dailyAssetAnalysisCreateSchema = z.object({ assetSymbol });

// Partial update — one field at a time, autosaved (mirrors arsenalConceptUpdateSchema).
export const dailyAssetAnalysisUpdateSchema = z
  .object({
    marketStructure: richText,
    htfBias: marketBiasSchema.nullable(),
    sessionBias: marketBiasSchema.nullable(),
    fundamentalBias: marketBiasSchema.nullable(),
    // Asset-specific fundamental evidence (USD strength, yields, geopolitical
    // risk, …) — independent of TradingDay.dailyFundamentalOutlook, which
    // stays the general day-level macro note.
    fundamentalNotes: richText,
    finalBias: finalBiasSchema.nullable(),
    notes: richText,
    keyLevels: richText,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const dailyAssetAnalysisReorderSchema = z.object({
  dateKey: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

/** Directional Evidence (Stage 11 §7-13) — a trader-defined, OPTIONAL
 *  bullish/bearish checklist item. `label`/`direction` required at creation;
 *  everything else (checked/note/reordering) is a later partial update. */
export const evidenceDirectionSchema = z.enum(["BULLISH", "BEARISH"]);

export const directionalEvidenceItemCreateSchema = z.object({
  dailyAssetAnalysisId: z.string().min(1),
  label: z.string().trim().min(1, "Label is required.").max(80, "Keep it short."),
  direction: evidenceDirectionSchema,
});

export const directionalEvidenceItemUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    direction: evidenceDirectionSchema,
    checked: z.boolean(),
    note: z.string().trim().max(280).nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export const directionalEvidenceReorderSchema = z.object({
  dailyAssetAnalysisId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type DailyAssetAnalysisCreateInput = z.infer<typeof dailyAssetAnalysisCreateSchema>;
export type DailyAssetAnalysisUpdateInput = z.infer<typeof dailyAssetAnalysisUpdateSchema>;
export type MarketBias = z.infer<typeof marketBiasSchema>;
export type FinalBias = z.infer<typeof finalBiasSchema>;
export type EvidenceDirectionInput = z.infer<typeof evidenceDirectionSchema>;
export type DirectionalEvidenceItemCreateInput = z.infer<typeof directionalEvidenceItemCreateSchema>;
export type DirectionalEvidenceItemUpdateInput = z.infer<typeof directionalEvidenceItemUpdateSchema>;
