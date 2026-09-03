import { z } from "zod";

import { directionSchema } from "@/lib/validation/trades";

export const missReasonSchema = z.enum([
  "FEAR",
  "HESITATION",
  "FOMO_ELSEWHERE",
  "DISTRACTED",
  "MISSED_ALERT",
  "LATE_CONFIRMATION",
  "RISK_CONCERNS",
  "TECHNICAL_ISSUE",
  "RULE_UNCERTAINTY",
  "INTENTIONAL_SKIP",
  "OTHER",
]);

export const missedOutcomeSchema = z.enum([
  "MISSED_WIN",
  "MISSED_LOSS",
  "MISSED_BREAKEVEN",
  "MISSED_UNDETERMINED",
]);

// Spotting a valid setup. A strategy is REQUIRED — validity (setupValid) is what
// makes something a real "opportunity", and that can only be scored against a
// strategy's expected confluences. Prices are optional (the idea may be rough).
export const opportunityCreateSchema = z.object({
  strategyId: z.string().min(1, "Select a strategy."),
  assetSymbol: z.string().min(1, "Select an asset."),
  direction: directionSchema,
  timeframe: z.string().trim().max(40).nullable().default(null),
  selectedConfluences: z.array(z.string()).default([]),
  selectedExecution: z.array(z.string()).default([]),
  plannedEntry: z.coerce.number().nullable().default(null),
  plannedStopLoss: z.coerce.number().nullable().default(null),
  plannedTarget: z.coerce.number().nullable().default(null),
  plannedRR: z.coerce.number().nullable().default(null),
});

// Recording that a valid setup was MISSED. The outcome is TRADER-ENTERED (Traditorium
// has no price feed): UNDETERMINED forfeits the realized-R field, while a
// win/loss/BE must carry a consistent realized-R sign so the data can't contradict
// itself (a "missed win" with a negative R, etc.).
export const missOutcomeSchema = z
  .object({
    missReason: missReasonSchema,
    missNote: z.string().trim().max(2000).nullable().default(null),
    missedOutcome: missedOutcomeSchema,
    missedRealizedR: z.coerce.number().nullable().default(null),
  })
  .superRefine((data, ctx) => {
    const r = data.missedRealizedR;
    switch (data.missedOutcome) {
      case "MISSED_UNDETERMINED":
        // No result to enter — force it null so it's excluded from the R cost.
        data.missedRealizedR = null;
        break;
      case "MISSED_WIN":
        if (r == null || r <= 0)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["missedRealizedR"],
            message: "A missed win needs a positive R.",
          });
        break;
      case "MISSED_LOSS":
        if (r == null || r >= 0)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["missedRealizedR"],
            message: "A missed loss needs a negative R.",
          });
        break;
      case "MISSED_BREAKEVEN":
        data.missedRealizedR = 0;
        break;
    }
  });

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;
export type MissOutcomeInput = z.infer<typeof missOutcomeSchema>;
