import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";

import { checkRRMismatch, computeTargetRMultiples, computeWeightedPlannedR } from "@/domain/trade-plan/planned-rr";

describe("computeTargetRMultiples", () => {
  it("computes long-trade R for the spec §3 worked example", () => {
    const results = computeTargetRMultiples("LONG", "1.08500", "1.08300", [
      { targetOrder: 1, targetPrice: "1.08700", plannedClosePercent: null },
      { targetOrder: 2, targetPrice: "1.08900", plannedClosePercent: null },
    ]);
    expect(results[0].rMultiple?.toNumber()).toBeCloseTo(1, 6);
    expect(results[1].rMultiple?.toNumber()).toBeCloseTo(2, 6);
  });

  it("computes short-trade R (risk = stop − entry, reward = entry − target)", () => {
    const results = computeTargetRMultiples("SHORT", "1.10000", "1.10200", [
      { targetOrder: 1, targetPrice: "1.09600", plannedClosePercent: null },
    ]);
    // risk = 0.00200, reward = 0.00400 -> 2R
    expect(results[0].rMultiple?.toNumber()).toBeCloseTo(2, 6);
  });

  it("returns null with a reason when entry/stop are missing", () => {
    const results = computeTargetRMultiples("LONG", null, "1.08300", [
      { targetOrder: 1, targetPrice: "1.08700", plannedClosePercent: null },
    ]);
    expect(results[0].rMultiple).toBeNull();
    expect(results[0].reason).toBeTruthy();
  });

  it("handles many targets independently", () => {
    const results = computeTargetRMultiples("LONG", "100", "90", [
      { targetOrder: 1, targetPrice: "110", plannedClosePercent: null },
      { targetOrder: 2, targetPrice: "120", plannedClosePercent: null },
      { targetOrder: 3, targetPrice: "130", plannedClosePercent: null },
    ]);
    expect(results.map((r) => r.rMultiple?.toNumber())).toEqual([1, 2, 3]);
  });
});

describe("computeWeightedPlannedR", () => {
  it("matches the spec §11 worked example: (1×0.30)+(2×0.40)+(3×0.30) = 2R", () => {
    const targets = [
      { targetOrder: 1, targetPrice: "0", plannedClosePercent: "30" },
      { targetOrder: 2, targetPrice: "0", plannedClosePercent: "40" },
      { targetOrder: 3, targetPrice: "0", plannedClosePercent: "30" },
    ];
    const targetRs = [
      { targetOrder: 1, rMultiple: new Decimal(1) },
      { targetOrder: 2, rMultiple: new Decimal(2) },
      { targetOrder: 3, rMultiple: new Decimal(3) },
    ];
    const result = computeWeightedPlannedR(targetRs, targets);
    expect(result.weightedR?.toNumber()).toBeCloseTo(2, 6);
    expect(result.totalAllocatedPercent.toNumber()).toBe(100);
    expect(result.remainingRunnerPercent.toNumber()).toBe(0);
    expect(result.incomplete).toBe(false);
  });

  it("labels the unallocated remainder as an open runner rather than assuming an exit", () => {
    const targets = [{ targetOrder: 1, targetPrice: "0", plannedClosePercent: "30" }];
    const targetRs = [{ targetOrder: 1, rMultiple: new Decimal(1) }];
    const result = computeWeightedPlannedR(targetRs, targets);
    expect(result.totalAllocatedPercent.toNumber()).toBe(30);
    expect(result.remainingRunnerPercent.toNumber()).toBe(70);
  });

  it("marks the result incomplete when a target has no planned close percent", () => {
    const targets = [{ targetOrder: 1, targetPrice: "0", plannedClosePercent: null }];
    const targetRs = [{ targetOrder: 1, rMultiple: new Decimal(1) }];
    const result = computeWeightedPlannedR(targetRs, targets);
    expect(result.incomplete).toBe(true);
  });

  it("is null (not zero) when no target has a resolved R yet", () => {
    const targets = [{ targetOrder: 1, targetPrice: "0", plannedClosePercent: "50" }];
    const targetRs = [{ targetOrder: 1, rMultiple: null }];
    const result = computeWeightedPlannedR(targetRs, targets);
    expect(result.weightedR).toBeNull();
    expect(result.incomplete).toBe(true);
  });
});

describe("checkRRMismatch", () => {
  it("flags a detected R:R that disagrees with the calculated value beyond tolerance", () => {
    const result = checkRRMismatch(3, new Decimal(1));
    expect(result.mismatched).toBe(true);
    expect(result.message).toMatch(/does not match/i);
  });

  it("does not flag a detected R:R within tolerance of a rounded calculated value", () => {
    const result = checkRRMismatch(2, new Decimal(1.97));
    expect(result.mismatched).toBe(false);
  });

  it("is silent when either value is unavailable", () => {
    expect(checkRRMismatch(null, new Decimal(1)).mismatched).toBe(false);
    expect(checkRRMismatch(2, null).mismatched).toBe(false);
  });
});
