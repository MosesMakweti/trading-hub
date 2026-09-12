import { z } from "zod";

// Empty string -> null; otherwise trimmed, length-capped free text — same
// convention as Trade's own review prompts (lib/validation/trades.ts's
// workspaceNote), kept short per Stage 8 §2 ("keep these concise").
const reflectionNote = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const dailyReflectionSchema = z
  .object({
    dayWentWell: reflectionNote,
    dayToImprove: reflectionNote,
    dayMainLesson: reflectionNote,
    dayCarryForward: reflectionNote,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });
export type DailyReflectionInput = z.infer<typeof dailyReflectionSchema>;

// Closing the day accepts the same reflection fields as a final safety-net
// save (in case the last edited field hasn't autosaved yet) — every field
// optional, since the trader may legitimately close a day with nothing (or
// only some of it) written down.
export const closeTradingDaySchema = z
  .object({
    dayWentWell: reflectionNote,
    dayToImprove: reflectionNote,
    dayMainLesson: reflectionNote,
    dayCarryForward: reflectionNote,
  })
  .partial();
export type CloseTradingDayInput = z.infer<typeof closeTradingDaySchema>;
