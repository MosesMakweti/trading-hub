import { z } from "zod";

import { isValidDateKey } from "@/lib/date";

/** Settings → Routine → Preparation Schedule. Timezone is the canonical trader timezone. */
export const preparationScheduleSchema = z.object({
  timezone: z.string().trim().min(1, "Choose a timezone.").max(64),
  targetMinutes: z.number().int().min(0).max(1439),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one trading weekday.").max(7),
});

export const preparationExceptionSchema = z.object({
  dateKey: z.string().refine(isValidDateKey, "Choose a valid date."),
  kind: z.enum(["DAY_OFF", "EXTRA_DAY"]),
  note: z
    .string()
    .trim()
    .max(120, "Keep the reason under 120 characters.")
    .optional()
    .transform((v) => (v ? v : null)),
});

export const preparationNoticeSchema = z.object({ recordId: z.string().min(1).max(64) });
