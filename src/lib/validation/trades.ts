import { z } from "zod";

export const directionSchema = z.enum(["LONG", "SHORT"]);
export const biasSchema = z.enum(["BULLISH", "BEARISH"]);
export const riskInputTypeSchema = z.enum(["PERCENT", "AMOUNT"]);

export const tradeAllocationSchema = z.object({
  tradingAccountId: z.string().min(1),
  riskInputType: riskInputTypeSchema,
  riskValue: z.coerce.number().min(0),
  closingPnlGross: z.coerce.number(),
  closingPnlNet: z.coerce.number(),
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
    hitTP1: z.boolean().default(false),
    hitTP2: z.boolean().default(false),
    hitTP3: z.boolean().default(false),
    hitFullTP: z.boolean().default(false),
    psychPreTradeMindset: z.string().trim().max(4000).nullable().default(null),
    psychPostTradeReflection: z.string().trim().max(4000).nullable().default(null),
    psychLessonsLearned: z.string().trim().max(4000).nullable().default(null),
    psychWhatToWorkOn: z.string().trim().max(4000).nullable().default(null),
    allocations: z.array(tradeAllocationSchema).min(1, "Select at least one account."),
    checklistItemIds: z.array(z.string()).default([]),
    entryModelIds: z.array(z.string()).default([]),
  })
  .refine(
    (data) => new Set(data.allocations.map((a) => a.tradingAccountId)).size === data.allocations.length,
    { message: "Each account can only be selected once.", path: ["allocations"] },
  );

export type TradeInput = z.infer<typeof tradeSchema>;
export type TradeFormValues = z.input<typeof tradeSchema>;
export type TradeAllocationInput = z.infer<typeof tradeAllocationSchema>;
