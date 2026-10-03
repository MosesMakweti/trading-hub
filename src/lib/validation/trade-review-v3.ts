import { z } from "zod";

import { partialPsychologyAnswersSchema } from "@/lib/validation/psychology";
import { workspaceNote as reviewNote } from "@/lib/validation/trades";

// Today V3 (Phase 3) — inputs of the V3 Review actions.

export const reviewIntentSchema = z.object({
  tradeIntent: z.enum(["PLANNED", "FOMO", "REVENGE", "BOREDOM", "IMPULSE", "MANUAL_OVERRIDE"]).nullable(),
});

export const reviewFieldsSchema = z
  .object({
    whatWentWell: reviewNote,
    whatCouldImprove: reviewNote,
    psychLessonsLearned: reviewNote,
    wouldTakeAgain: z.boolean().nullable(),
    adherenceAnswers: z.record(z.string(), z.boolean()),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

export const reviewPsychologySchema = z.object({ answers: partialPsychologyAnswersSchema });
