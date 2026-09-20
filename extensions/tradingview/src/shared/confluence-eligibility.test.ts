import { describe, expect, it } from "vitest";

import { isConfluenceEligible } from "./confluence-eligibility";

// This truth table intentionally mirrors the one documented in the SERVER's
// own confluence-score.ts — see this module's doc comment on why that's the
// only current contract-drift safeguard.
describe("isConfluenceEligible", () => {
  it("BOTH is eligible for either direction", () => {
    expect(isConfluenceEligible("BOTH", "LONG")).toBe(true);
    expect(isConfluenceEligible("BOTH", "SHORT")).toBe(true);
  });

  it("BULLISH is eligible for LONG only", () => {
    expect(isConfluenceEligible("BULLISH", "LONG")).toBe(true);
    expect(isConfluenceEligible("BULLISH", "SHORT")).toBe(false);
  });

  it("BEARISH is eligible for SHORT only", () => {
    expect(isConfluenceEligible("BEARISH", "SHORT")).toBe(true);
    expect(isConfluenceEligible("BEARISH", "LONG")).toBe(false);
  });

  it("a missing/null applicability defaults to BOTH — eligible either way", () => {
    expect(isConfluenceEligible(null, "LONG")).toBe(true);
    expect(isConfluenceEligible(undefined, "SHORT")).toBe(true);
  });

  it("nothing is eligible when no direction has been chosen yet (null)", () => {
    expect(isConfluenceEligible("BOTH", null)).toBe(false);
    expect(isConfluenceEligible("BULLISH", null)).toBe(false);
    expect(isConfluenceEligible("BEARISH", null)).toBe(false);
    expect(isConfluenceEligible(null, null)).toBe(false);
  });
});
