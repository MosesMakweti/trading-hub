import { describe, expect, it } from "vitest";

import { effectiveRiskPercent, scalePnlByRisk } from "./allocation";

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

describe("scalePnlByRisk", () => {
  // The exact worked example from the spec.
  it("gives 100% of the result to an account risking the same 1%", () => {
    expect(scalePnlByRisk(2500, 1)).toBe(2500);
  });

  it("gives 50% of the result to an account risking half (0.5%)", () => {
    expect(scalePnlByRisk(2500, 0.5)).toBe(1250);
  });

  it("gives 200% of the result to an account risking double (2%)", () => {
    expect(scalePnlByRisk(2500, 2)).toBe(5000);
  });

  it("scales losses the same proportional way", () => {
    expect(scalePnlByRisk(-1000, 0.5)).toBe(-500);
    expect(scalePnlByRisk(-1000, 2)).toBe(-2000);
  });

  it("returns 0 when the participating account risked nothing", () => {
    expect(scalePnlByRisk(2500, 0)).toBe(0);
  });
});
