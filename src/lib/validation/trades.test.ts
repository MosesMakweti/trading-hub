import { describe, expect, it } from "vitest";

import { tradeSchema } from "@/lib/validation/trades";

/** Trade Idea Validation Shield (Stage 4) — the zod-level override guard.
 *  Everything else about validation state is computed server-side
 *  (see trade-setup-validation.service.test.ts); this only covers what a
 *  malformed submission looks like before it ever reaches the service. */

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    ...overrides,
  };
}

describe("tradeSchema — Setup Type override reason", () => {
  it("requires a note when the reason is OTHER", () => {
    const result = tradeSchema.safeParse(baseInput({ setupOverrideReason: "OTHER", setupOverrideNote: null }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("setupOverrideNote"))).toBe(true);
    }
  });

  it("accepts OTHER once a note is provided", () => {
    const result = tradeSchema.safeParse(
      baseInput({ setupOverrideReason: "OTHER", setupOverrideNote: "Something specific." }),
    );
    expect(result.success).toBe(true);
  });

  it("doesn't require a note for a non-OTHER reason", () => {
    const result = tradeSchema.safeParse(baseInput({ setupOverrideReason: "FOMO", setupOverrideNote: null }));
    expect(result.success).toBe(true);
  });

  it("defaults every Setup Type field to null/empty when omitted (legacy flow)", () => {
    const result = tradeSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.setupTypeId).toBeNull();
      expect(result.data.selectedSetupConditions).toEqual([]);
      expect(result.data.setupOverrideReason).toBeNull();
    }
  });
});

describe("tradeSchema — Pre-Trade Mood Snapshot", () => {
  it("accepts an intensity between 1 and 5", () => {
    for (const intensity of [1, 3, 5]) {
      expect(tradeSchema.safeParse(baseInput({ preTradeMoodIntensity: intensity })).success).toBe(true);
    }
  });

  it("rejects an intensity outside 1-5", () => {
    expect(tradeSchema.safeParse(baseInput({ preTradeMoodIntensity: 0 })).success).toBe(false);
    expect(tradeSchema.safeParse(baseInput({ preTradeMoodIntensity: 6 })).success).toBe(false);
  });

  it("rejects an unknown mood tag", () => {
    const result = tradeSchema.safeParse(baseInput({ preTradeMoodTags: ["ANGRY"] }));
    expect(result.success).toBe(false);
  });

  it("allows multiple tags at once and defaults to none", () => {
    const withTags = tradeSchema.safeParse(baseInput({ preTradeMoodTags: ["FOCUSED", "IMPATIENT"] }));
    expect(withTags.success).toBe(true);
    const withoutTags = tradeSchema.safeParse(baseInput());
    expect(withoutTags.success).toBe(true);
    if (withoutTags.success) expect(withoutTags.data.preTradeMoodTags).toEqual([]);
  });
});
