import { describe, expect, it } from "vitest";

import { scoreStrategyAdherence, type StrategyExpectedSet } from "./strategy-adherence";

const tag = (name: string) => ({ name, color: "GRAY" });

const expected: Pick<StrategyExpectedSet, "confluences" | "execution"> = {
  confluences: [tag("HTF Bias"), tag("Liquidity Sweep"), tag("FVG"), tag("MSS")],
  execution: [tag("Candle Close"), tag("Break of Structure")],
};

describe("scoreStrategyAdherence", () => {
  it("scores selected / expected per group and averages for quality", () => {
    const r = scoreStrategyAdherence(expected, ["HTF Bias", "Liquidity Sweep", "FVG"], ["Candle Close"]);
    expect(r.confluencePercent).toBe(75); // 3 of 4
    expect(r.executionPercent).toBe(50); // 1 of 2
    expect(r.tradeQualityPercent).toBe(63); // mean(75,50)=62.5 → 63
  });

  it("full adherence is 100", () => {
    const r = scoreStrategyAdherence(
      expected,
      ["HTF Bias", "Liquidity Sweep", "FVG", "MSS"],
      ["Candle Close", "Break of Structure"],
    );
    expect(r).toEqual({ confluencePercent: 100, executionPercent: 100, tradeQualityPercent: 100 });
  });

  it("is case-insensitive and ignores selections not in the expected set", () => {
    const r = scoreStrategyAdherence(expected, ["htf bias", "not a real one"], []);
    expect(r.confluencePercent).toBe(25); // only HTF Bias counts, of 4
    expect(r.executionPercent).toBe(0); // none of 2
  });

  it("returns null for a group the strategy didn't define", () => {
    const r = scoreStrategyAdherence({ confluences: [tag("A")], execution: [] }, ["A"], []);
    expect(r.confluencePercent).toBe(100);
    expect(r.executionPercent).toBeNull();
    expect(r.tradeQualityPercent).toBe(100); // only confluence applies
  });

  it("is all-null when no strategy set is provided", () => {
    expect(scoreStrategyAdherence(null, ["X"], ["Y"])).toEqual({
      confluencePercent: null,
      executionPercent: null,
      tradeQualityPercent: null,
    });
  });

  describe("direction-aware confluence denominator", () => {
    const cf = (
      name: string,
      directionApplicability: "BULLISH" | "BEARISH" | "BOTH",
    ) => ({ name, color: "GRAY", directionApplicability });
    const set = {
      confluences: [
        cf("Bull MSB", "BULLISH"),
        cf("Bear MSB", "BEARISH"),
        cf("At key level", "BOTH"),
      ],
      execution: [tag("Candle Close")],
    };

    it("a long trade is only measured against BULLISH + BOTH confluences", () => {
      const r = scoreStrategyAdherence(set, ["Bull MSB"], [], "LONG");
      // eligible = Bull MSB + At key level (2). 1 selected → 50%.
      expect(r.confluencePercent).toBe(50);
    });

    it("a stale bearish selection doesn't count and doesn't shrink the denominator", () => {
      const r = scoreStrategyAdherence(set, ["Bear MSB", "At key level"], [], "LONG");
      // eligible = Bull MSB + At key level. Only "At key level" matches → 1 of 2.
      expect(r.confluencePercent).toBe(50);
    });

    it("a short trade is measured against BEARISH + BOTH", () => {
      const r = scoreStrategyAdherence(set, ["Bear MSB", "At key level"], [], "SHORT");
      expect(r.confluencePercent).toBe(100); // both eligible ones selected
    });

    it("without a direction every confluence still counts (legacy behaviour)", () => {
      const r = scoreStrategyAdherence(set, ["Bull MSB"], []);
      expect(r.confluencePercent).toBe(33); // 1 of 3
    });
  });
});
