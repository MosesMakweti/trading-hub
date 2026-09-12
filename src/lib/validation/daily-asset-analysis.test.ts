import { describe, expect, it } from "vitest";

import {
  dailyAssetAnalysisCreateSchema,
  dailyAssetAnalysisReorderSchema,
  dailyAssetAnalysisUpdateSchema,
} from "./daily-asset-analysis";

describe("dailyAssetAnalysisCreateSchema", () => {
  it("requires a non-empty asset symbol", () => {
    expect(dailyAssetAnalysisCreateSchema.safeParse({ assetSymbol: "XAUUSD" }).success).toBe(true);
    expect(dailyAssetAnalysisCreateSchema.safeParse({ assetSymbol: "" }).success).toBe(false);
    expect(dailyAssetAnalysisCreateSchema.safeParse({ assetSymbol: "   " }).success).toBe(false);
  });
});

describe("dailyAssetAnalysisUpdateSchema — bias philosophy: independent fields, never coupled", () => {
  it("rejects an empty patch", () => {
    expect(dailyAssetAnalysisUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts each of the three market biases independently, including disagreeing values", () => {
    const r = dailyAssetAnalysisUpdateSchema.safeParse({
      htfBias: "BULLISH",
      sessionBias: "BEARISH",
      fundamentalBias: "NEUTRAL",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.htfBias).toBe("BULLISH");
      expect(r.data.sessionBias).toBe("BEARISH");
      expect(r.data.fundamentalBias).toBe("NEUTRAL");
    }
  });

  it("accepts a final bias of NEUTRAL even when every market bias is directional", () => {
    const r = dailyAssetAnalysisUpdateSchema.safeParse({
      htfBias: "BULLISH",
      fundamentalBias: "BULLISH",
      finalBias: "NEUTRAL",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a final bias value from the market-bias vocabulary (different enums)", () => {
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ finalBias: "BULLISH" }).success).toBe(false);
  });

  it("rejects a market bias value from the final-bias vocabulary (different enums)", () => {
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ htfBias: "LONG" }).success).toBe(false);
  });

  it("allows clearing a bias back to null", () => {
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ htfBias: null }).success).toBe(true);
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ finalBias: null }).success).toBe(true);
  });

  it("accepts rich-text fields as arbitrary JSON or null", () => {
    expect(
      dailyAssetAnalysisUpdateSchema.safeParse({ marketStructure: { type: "doc", content: [] } })
        .success,
    ).toBe(true);
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ notes: null }).success).toBe(true);
    expect(dailyAssetAnalysisUpdateSchema.safeParse({ keyLevels: null }).success).toBe(true);
  });
});

describe("dailyAssetAnalysisReorderSchema", () => {
  it("requires a dateKey and at least one ordered id", () => {
    expect(
      dailyAssetAnalysisReorderSchema.safeParse({ dateKey: "2026-09-12", orderedIds: ["a", "b"] })
        .success,
    ).toBe(true);
    expect(dailyAssetAnalysisReorderSchema.safeParse({ dateKey: "2026-09-12", orderedIds: [] }).success).toBe(
      false,
    );
    expect(dailyAssetAnalysisReorderSchema.safeParse({ orderedIds: ["a"] }).success).toBe(false);
  });
});
