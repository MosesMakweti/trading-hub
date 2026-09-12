import { z } from "zod";

/**
 * Daily Market Plan patch (Stage 11). Partial — the section autosaves piece
 * by piece. `planComplete` finalizes the step (sets/clears the day's
 * planCompletedAt).
 *
 * Stage 11 retired `bias`/`conviction`/`keyLevels`/`watchlist` from this
 * schema — they duplicated DailyAssetAnalysis's per-asset htfBias/finalBias/
 * keyLevels and "Today's Assets" (DailyAssetAnalysis is now that list
 * directly). The TradingDay columns still exist and still read back for
 * historical days that used them (see TodaysPlanDTO/DailyMarketPlanRecap), but
 * nothing writes to them anymore.
 */
export const dayBiasSchema = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);

/** Free-form tag arrays (sessions) — trimmed, de-duplicated by the caller
 *  (see AssetTagInput); validated here only for shape/size. */
const tagListSchema = z.array(z.string().trim().min(1).max(40)).max(50);

export const todaysPlanSchema = z
  .object({
    riskBudgetPercent: z.coerce.number().min(0).max(100).nullable(),
    planComplete: z.boolean(),

    // Daily Market Plan — General Session Context (day-level, asset-independent)
    lookingFor: z.unknown(),
    activeSessions: tagListSchema,
    importantConditions: z.unknown(),
    stayOutConditions: z.unknown(),

    // Daily Market Plan — Risk Boundaries
    maxTradesPerDay: z.coerce.number().int().min(0).max(500).nullable(),

    // Daily Market Plan — News & Fundamentals. dailyFundamentalOutlook is a
    // GENERAL macro/fundamental note for the day, deliberately not a single
    // bullish/neutral/bearish bias — per-asset fundamental views belong to
    // DailyAssetAnalysis, not to the day as a whole.
    newsAcknowledged: z.boolean(),
    newsNotes: z.unknown(),
    dailyFundamentalOutlook: z.unknown(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type TodaysPlanInput = z.infer<typeof todaysPlanSchema>;
export type DayBias = z.infer<typeof dayBiasSchema>;
