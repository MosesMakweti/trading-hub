import { describe, expect, it } from "vitest";

import { filterPatterns, type PatternSearchable } from "@/domain/strategies/patterns";

const p = (
  name: string,
  strategyName: string,
  descriptionPreview = "",
  conditionsPreview = "",
): PatternSearchable => ({ name, strategyName, descriptionPreview, conditionsPreview });

const items = [
  p("FVG Entry", "Silver Bullet", "fair value gap on M5", "wait for retrace"),
  p("Order Block", "Silver Bullet", "bullish OB", "sweep then mitigation"),
  p("Trend Continuation", "NASDAQ Trend", "pullback to EMA", "higher high structure"),
];

describe("filterPatterns", () => {
  it("returns everything for an empty query", () => {
    expect(filterPatterns(items, "")).toHaveLength(3);
    expect(filterPatterns(items, "   ")).toHaveLength(3);
  });

  it("matches on the pattern name", () => {
    expect(filterPatterns(items, "order").map((x) => x.name)).toEqual(["Order Block"]);
  });

  it("matches on the strategy name", () => {
    expect(filterPatterns(items, "nasdaq").map((x) => x.name)).toEqual(["Trend Continuation"]);
  });

  it("matches on preview text", () => {
    expect(filterPatterns(items, "mitigation").map((x) => x.name)).toEqual(["Order Block"]);
  });

  it("requires every term to match (AND)", () => {
    expect(filterPatterns(items, "silver fvg").map((x) => x.name)).toEqual(["FVG Entry"]);
    expect(filterPatterns(items, "silver nasdaq")).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    expect(filterPatterns(items, "SILVER BULLET")).toHaveLength(2);
  });
});
