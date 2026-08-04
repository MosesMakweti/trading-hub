import { z } from "zod";

/**
 * Weekly review reflection patch (P10). Partial — each rich-text section
 * autosaves on its own. Values are Tiptap JSON.
 */
export const weeklyReviewSchema = z
  .object({
    wentWell: z.unknown(),
    toImprove: z.unknown(),
    focusNextWeek: z.unknown(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type WeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;
