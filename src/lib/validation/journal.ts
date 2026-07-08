import { z } from "zod";

import { isValidDateKey } from "@/lib/date";

export const dateKeySchema = z.string().refine(isValidDateKey, "Invalid date.");

// Tiptap documents are arbitrary JSON; structural validation happens in the editor itself.
export const dailyNoteSchema = z.object({
  content: z.unknown().nullable(),
});

export type DailyNoteInput = z.infer<typeof dailyNoteSchema>;
