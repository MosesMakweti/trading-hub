import { describe, expect, it } from "vitest";

import { todaysPlanSchema } from "./today";

describe("todaysPlanSchema — Daily Market Plan (day-level fields only)", () => {
  it("rejects an empty patch", () => {
    expect(todaysPlanSchema.safeParse({}).success).toBe(false);
  });

  it("Stage 11: bias/conviction/keyLevels/watchlist are retired — a patch containing only those fails as 'nothing to update'", () => {
    // These are unknown keys to the (now-partial) schema, so they're stripped
    // before the "at least one field" refinement runs — exactly the intended
    // effect of retiring the day-level HTF bias / areas-of-interest / watchlist
    // duplication (DailyAssetAnalysis owns all of these now).
    expect(todaysPlanSchema.safeParse({ bias: "BULLISH" }).success).toBe(false);
    expect(todaysPlanSchema.safeParse({ conviction: 4 }).success).toBe(false);
    expect(todaysPlanSchema.safeParse({ keyLevels: { type: "doc", content: [] } }).success).toBe(false);
    expect(todaysPlanSchema.safeParse({ watchlist: ["XAUUSD"] }).success).toBe(false);
  });

  it("accepts each remaining Daily Market Plan field independently", () => {
    expect(todaysPlanSchema.safeParse({ lookingFor: { type: "doc", content: [] } }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ activeSessions: ["LONDON", "NEW YORK"] }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ importantConditions: null }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ stayOutConditions: null }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ maxTradesPerDay: 3 }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ maxTradesPerDay: null }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ newsAcknowledged: true }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ newsNotes: null }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ dailyFundamentalOutlook: null }).success).toBe(true);
    expect(todaysPlanSchema.safeParse({ riskBudgetPercent: 2 }).success).toBe(true);
  });

  it("rejects a negative or non-integer max trades", () => {
    expect(todaysPlanSchema.safeParse({ maxTradesPerDay: -1 }).success).toBe(false);
    expect(todaysPlanSchema.safeParse({ maxTradesPerDay: 2.5 }).success).toBe(false);
  });

  it("rejects an oversized sessions tag list", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `TAG${i}`);
    expect(todaysPlanSchema.safeParse({ activeSessions: tooMany }).success).toBe(false);
  });

  it("rejects an empty-string session tag", () => {
    expect(todaysPlanSchema.safeParse({ activeSessions: [""] }).success).toBe(false);
  });

  it("does not treat fundamental outlook as a bias enum — any JSON content is accepted", () => {
    // Deliberately not a BULLISH/BEARISH/NEUTRAL enum — general notes only.
    const r = todaysPlanSchema.safeParse({ dailyFundamentalOutlook: { type: "doc", content: [] } });
    expect(r.success).toBe(true);
  });
});
