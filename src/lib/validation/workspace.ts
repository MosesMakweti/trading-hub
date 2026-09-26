import { z } from "zod";

import { isValidDateKey } from "@/lib/date";

/**
 * Backtesting (Stage 3) — how a DAY-LEVEL server action learns which
 * environment it acts in. `runId` is REQUIRED and nullable, never optional:
 * `null` = LIVE, a run id = that Backtest Run. There is deliberately no
 * default, so every call site has to state its environment (TypeScript
 * enforces it; the schema rejects a missing key at runtime too).
 */
export interface WorkspaceDayRef {
  dateKey: string;
  runId: string | null;
}

export const workspaceDayRefSchema = z
  .object({
    dateKey: z.string().refine(isValidDateKey, "Invalid date."),
    runId: z.string().min(1).nullable(),
  })
  .strict();

export function liveDay(dateKey: string): WorkspaceDayRef {
  return { dateKey, runId: null };
}
