import { z } from "zod";

/**
 * Today's Trading Plan patch. Partial — the section autosaves piece by
 * piece. `keyLevels` is Tiptap JSON, and `planComplete` finalizes the step
 * (sets/clears the day's planCompletedAt).
 */
export const dayBiasSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);

export const todaysPlanSchema = z
  .object({
    bias: dayBiasSchema.nullable(),
    conviction: z.number().int().min(1).max(5).nullable(),
    keyLevels: z.unknown(),
    riskBudgetPercent: z.coerce.number().min(0).max(100).nullable(),
    planComplete: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type TodaysPlanInput = z.infer<typeof todaysPlanSchema>;
export type DayBias = z.infer<typeof dayBiasSchema>;
