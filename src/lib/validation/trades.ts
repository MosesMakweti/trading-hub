import { z } from "zod";

import { psychologyAnswersSchema } from "@/lib/validation/psychology";

export const directionSchema = z.enum(["LONG", "SHORT"]);
export const biasSchema = z.enum(["BULLISH", "BEARISH"]);
export const riskInputTypeSchema = z.enum(["PERCENT", "AMOUNT"]);

// Participating (non-Performance) accounts only ever specify risk — their
// PnL is always auto-calculated from the Performance Account's entered PnL,
// scaled by relative risk% (see domain/performance/allocation.ts).
export const tradeAllocationSchema = z.object({
  tradingAccountId: z.string().min(1),
  riskInputType: riskInputTypeSchema,
  riskValue: z.coerce.number().min(0),
});

export const tradeSchema = z
  .object({
    assetId: z.string().min(1, "Select an asset."),
    executionMinutes: z.coerce.number().int().min(0).max(1439),
    direction: directionSchema,
    higherTimeframeBias: biasSchema,
    biasConfidencePercent: z.coerce.number().int().min(0).max(100),
    sessionId: z.string().nullable().default(null),
    expectedRR: z.coerce.number(),
    actualRR: z.coerce.number().nullable().default(null),
    // The one Closing PnL the trader manually enters — always the
    // Performance Account's real dollar result for this trade.
    performanceClosingPnlGross: z.coerce.number(),
    performanceClosingPnlNet: z.coerce.number(),
    hitTP1: z.boolean().default(false),
    hitTP2: z.boolean().default(false),
    hitTP3: z.boolean().default(false),
    hitFullTP: z.boolean().default(false),
    psychPreTradeMindset: z.string().trim().max(4000).nullable().default(null),
    psychPostTradeReflection: z.string().trim().max(4000).nullable().default(null),
    psychLessonsLearned: z.string().trim().max(4000).nullable().default(null),
    psychWhatToWorkOn: z.string().trim().max(4000).nullable().default(null),
    // Additional participating accounts beyond the Performance Account —
    // may be empty (a trade can affect only the Performance Account).
    allocations: z.array(tradeAllocationSchema).default([]),
    checklistItemIds: z.array(z.string()).default([]),
    entryModelIds: z.array(z.string()).default([]),
    psychologyAnswers: psychologyAnswersSchema,
  })
  .refine(
    (data) => new Set(data.allocations.map((a) => a.tradingAccountId)).size === data.allocations.length,
    { message: "Each account can only be selected once.", path: ["allocations"] },
  );

export type TradeInput = z.infer<typeof tradeSchema>;
export type TradeFormValues = z.input<typeof tradeSchema>;
export type TradeAllocationInput = z.infer<typeof tradeAllocationSchema>;
export type RiskInputType = z.infer<typeof riskInputTypeSchema>;
