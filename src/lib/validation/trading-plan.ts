import { z } from "zod";

// NOTE: this module now holds only the operational "Trade Setup" list schemas
// (assets, entry models, sessions, checklists). The Trading Plan methodology
// schemas (framework / profit-taking / stop-loss / risk-management) were removed
// — that content is owned by Strategy Lab. See docs/PRE_SESSION_ROUTINE.md.

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

export const tradingSessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  startMinutes: z.coerce.number().int().min(0).max(1439),
  endMinutes: z.coerce.number().int().min(0).max(1439),
  maxDailyTradingMinutes: z.coerce.number().int().min(0).nullable().optional(),
  maxTradesPerDay: z.coerce.number().int().min(0).nullable().optional(),
});

export const checklistTypeSchema = z.enum([
  "CONFLUENCE",
  "EXECUTION_CONFIRMATION",
  "PRE_SESSION_ROUTINE",
]);

export const checklistItemSchema = z.object({
  type: checklistTypeSchema,
  label: z.string().trim().min(1, "Label is required.").max(120),
});

export const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export type AssetInput = z.infer<typeof assetSchema>;
export type TradingSessionInput = z.infer<typeof tradingSessionSchema>;
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
