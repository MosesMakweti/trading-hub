import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import { daysBetweenInclusive, listTradingDayKeys, MAX_RUN_LENGTH_DAYS } from "@/domain/backtesting/run-calendar";

/** Later period refinements only apply once both dates parse and are ordered
 *  (the earlier issue is the useful message). */
function validPeriod(v: { startDate: string; endDate: string }): boolean {
  return isValidDateKey(v.startDate) && isValidDateKey(v.endDate) && v.endDate >= v.startDate;
}

const dateKeySchema = z.string().refine(isValidDateKey, "Use a valid YYYY-MM-DD date.");

/** Backtest Run creation (Stage 1). The period is inclusive and historical
 *  by intent, but a future end date isn't rejected — the trader may be
 *  replaying up to "now" in their external chart. */
export const createBacktestRunSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    description: z.string().trim().max(2000).nullish(),
    strategyId: z.string().min(1).nullish(),
    assets: z.array(z.string().trim().toUpperCase().min(1).max(20)).min(1, "Add at least one asset to test.").max(30),
    startDate: dateKeySchema,
    endDate: dateKeySchema,
    tradingWeekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Select at least one trading weekday.")
      .max(7)
      .default([1, 2, 3, 4, 5]),
    startingBalance: z.coerce.number().positive().max(1e12).nullish(),
    riskPercentPerTrade: z.coerce.number().positive().max(100).nullish(),
    currency: z.string().trim().toUpperCase().length(3).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be on or after the start date.", path: ["endDate"] })
  .refine((v) => !validPeriod(v) || daysBetweenInclusive(v.startDate, v.endDate) <= MAX_RUN_LENGTH_DAYS, {
    message: "A run can span at most five years.",
    path: ["endDate"],
  })
  .refine(
    (v) =>
      !validPeriod(v) ||
      daysBetweenInclusive(v.startDate, v.endDate) > MAX_RUN_LENGTH_DAYS ||
      listTradingDayKeys({ startDateKey: v.startDate, endDateKey: v.endDate, tradingWeekdays: v.tradingWeekdays }).length > 0,
    { message: "This period has no trading days for the selected weekdays.", path: ["tradingWeekdays"] },
  );

export const backtestRunStatusSchema = z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]);

export type CreateBacktestRunInput = z.infer<typeof createBacktestRunSchema>;
