import { describe, expect, it } from "vitest";

import { effectiveRiskPercent } from "./allocation";

describe("effectiveRiskPercent", () => {
  it("passes through a PERCENT risk input unchanged", () => {
    expect(effectiveRiskPercent("PERCENT", 1.5, 50_000)).toBe(1.5);
  });

  it("converts an AMOUNT risk input to a % of the account's balance", () => {
    expect(effectiveRiskPercent("AMOUNT", 500, 50_000)).toBe(1);
    expect(effectiveRiskPercent("AMOUNT", 250, 50_000)).toBe(0.5);
  });

  it("returns 0 for a non-positive balance rather than Infinity/NaN", () => {
    expect(effectiveRiskPercent("AMOUNT", 500, 0)).toBe(0);
    expect(effectiveRiskPercent("AMOUNT", 500, -100)).toBe(0);
  });
});
