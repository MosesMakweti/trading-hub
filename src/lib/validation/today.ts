import { z } from "zod";

/**
 * Morning Preparation patch (P3). Partial — the section autosaves one piece at a
 * time. `routineCompletion` is the ticked pre-session-routine item ids,
 * `marketContext` is Tiptap JSON, `readiness` a 1–5 self-rating, and
 * `prepComplete` finalizes the step (sets/clears the day's prepCompletedAt).
 */
export const morningPrepSchema = z
  .object({
    routineCompletion: z.array(z.string()).max(500),
    marketContext: z.unknown(),
    readiness: z.number().int().min(1).max(5).nullable(),
    prepComplete: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type MorningPrepInput = z.infer<typeof morningPrepSchema>;

/**
 * Today's Trading Plan patch (P4). Partial — the section autosaves piece by
 * piece. `watchlistFocus` is the focused Asset ids, `keyLevels` is Tiptap JSON,
 * and `planComplete` finalizes the step (sets/clears the day's planCompletedAt).
 */
export const dayBiasSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);

export const todaysPlanSchema = z
  .object({
    bias: dayBiasSchema.nullable(),
    conviction: z.number().int().min(1).max(5).nullable(),
    watchlistFocus: z.array(z.string()).max(500),
    keyLevels: z.unknown(),
    riskBudgetPercent: z.coerce.number().min(0).max(100).nullable(),
    planComplete: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type TodaysPlanInput = z.infer<typeof todaysPlanSchema>;
export type DayBias = z.infer<typeof dayBiasSchema>;
