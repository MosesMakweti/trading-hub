import { z } from "zod";

// Tiptap documents are arbitrary JSON; structure is enforced by the editor.
const richText = z.unknown().nullable();

/** Trade-management rich-text field keys, in display order. Reused by UI + duplicate. */
export const TRADE_MANAGEMENT_RICH_FIELDS = [
  "takeProfitPhilosophy",
  "initialStopPlacement",
  "breakEvenRules",
  "trailingStopRules",
  "scalingInRules",
  "scalingOutRules",
] as const;

export type TradeManagementRichField = (typeof TRADE_MANAGEMENT_RICH_FIELDS)[number];

// Partial update — any subset of rich fields and/or the two structured limits.
// `null` clears a value; the number is coerced from the form input.
export const tradeManagementUpdateSchema = z.object({
  takeProfitPhilosophy: richText.optional(),
  initialStopPlacement: richText.optional(),
  breakEvenRules: richText.optional(),
  trailingStopRules: richText.optional(),
  scalingInRules: richText.optional(),
  scalingOutRules: richText.optional(),
  maxHoldingTime: z.string().trim().max(60).nullable().optional(),
  maxRiskPercent: z.number().min(0).max(100).nullable().optional(),
});

// ── Partial take-profit levels ───────────────────────────────────────────────
export const partialTakeProfitUpdateSchema = z.object({
  trigger: z.string().trim().max(120).nullable().optional(),
  percentToClose: z.number().min(0).max(100).nullable().optional(),
  reason: z.string().trim().max(280).nullable().optional(),
});

export const partialTakeProfitReorderSchema = z.object({
  tradeManagementId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

// ── Custom rules (simple text list) ──────────────────────────────────────────
export const customRuleSchema = z.object({
  text: z.string().trim().min(1, "Rule can't be empty.").max(280),
});

export const customRuleReorderSchema = z.object({
  tradeManagementId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export type TradeManagementUpdateInput = z.infer<typeof tradeManagementUpdateSchema>;
export type PartialTakeProfitUpdateInput = z.infer<typeof partialTakeProfitUpdateSchema>;
