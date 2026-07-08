import { z } from "zod";

// Tiptap documents are arbitrary JSON; structural validation happens in the editor itself.
const richText = z.unknown().nullable();

export const dailyRoutineSchema = z.object({
  dailyRoutineMorning: richText,
  dailyRoutinePreMarket: richText,
  dailyRoutinePostSession: richText,
});

export const strategyFrameworkSchema = z.object({
  strategyFramework: richText,
});

export const profitTakingSchema = z.object({
  profitTakingRules: richText,
});

export const stopLossSchema = z.object({
  stopLossPlacement: richText,
});

export const riskManagementSchema = z.object({
  maxDailyRiskPercent: z.coerce.number().min(0).max(100).nullable(),
  maxWeeklyRiskPercent: z.coerce.number().min(0).max(100).nullable(),
  maxOpenPositions: z.coerce.number().int().min(0).nullable(),
  maxRiskPerTradePercent: z.coerce.number().min(0).max(100).nullable(),
  riskManagementRules: richText,
});

export const assetSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(20)
    .transform((v) => v.toUpperCase()),
  label: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const entryModelSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const tradingSessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  startMinutes: z.coerce.number().int().min(0).max(1439),
  endMinutes: z.coerce.number().int().min(0).max(1439),
  maxDailyTradingMinutes: z.coerce.number().int().min(0).nullable().optional(),
  maxTradesPerDay: z.coerce.number().int().min(0).nullable().optional(),
});

export const psychAnchorSchema = z.object({
  text: z.string().trim().min(1, "Text is required.").max(280),
});

export const checklistTypeSchema = z.enum(["CONFLUENCE", "EXECUTION_CONFIRMATION"]);

export const checklistItemSchema = z.object({
  type: checklistTypeSchema,
  label: z.string().trim().min(1, "Label is required.").max(120),
});

export const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export type DailyRoutineInput = z.infer<typeof dailyRoutineSchema>;
export type StrategyFrameworkInput = z.infer<typeof strategyFrameworkSchema>;
export type ProfitTakingInput = z.infer<typeof profitTakingSchema>;
export type StopLossInput = z.infer<typeof stopLossSchema>;
export type RiskManagementInput = z.infer<typeof riskManagementSchema>;
export type AssetInput = z.infer<typeof assetSchema>;
export type EntryModelInput = z.infer<typeof entryModelSchema>;
export type TradingSessionInput = z.infer<typeof tradingSessionSchema>;
export type PsychAnchorInput = z.infer<typeof psychAnchorSchema>;
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
