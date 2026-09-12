import { describe, expect, it } from "vitest";

import { computeRealizedRProgress } from "@/domain/trades/realized-r-progress";

describe("computeRealizedRProgress", () => {
  it("matches the spec's weighted example exactly: 30%@1R + 30%@2R + 40%@3R = +2.10R", () => {
    // LONG entry 100, stop 90 -> 10-unit risk. 1R=110, 2R=120, 3R=130.
    const result = computeRealizedRProgress("LONG", 100, 90, [
      { price: 110, proportion: 30 },
      { price: 120, proportion: 30 },
      { price: 130, proportion: 40 },
    ]);
    expect(result.realizedRSoFar?.toNumber()).toBeCloseTo(2.1, 6);
    expect(result.isFullyClosed).toBe(true);
    expect(result.proportionClosed.toNumber()).toBe(100);
    expect(result.remainingProportion.toNumber()).toBe(0);
  });

  it("reports realized R so far for a partially closed position, with an open remainder", () => {
    const result = computeRealizedRProgress("LONG", 100, 90, [{ price: 110, proportion: 30 }]);
    expect(result.realizedRSoFar?.toNumber()).toBeCloseTo(0.3, 6); // 30% * 1R
    expect(result.isFullyClosed).toBe(false);
    expect(result.proportionClosed.toNumber()).toBe(30);
    expect(result.remainingProportion.toNumber()).toBe(70);
  });

  it("handles multiple partials that don't sum to 100 (still holding a remainder)", () => {
    const result = computeRealizedRProgress("SHORT", 100, 110, [
      { price: 90, proportion: 25 },
      { price: 80, proportion: 25 },
    ]);
    expect(result.proportionClosed.toNumber()).toBe(50);
    expect(result.remainingProportion.toNumber()).toBe(50);
    expect(result.isFullyClosed).toBe(false);
    // 1R at 90 (short, risk=10, reward=10 -> 1R), 2R at 80 -> weighted 0.25*1 + 0.25*2 = 0.75
    expect(result.realizedRSoFar?.toNumber()).toBeCloseTo(0.75, 6);
  });

  it("returns null realizedRSoFar with no exits yet (never a misleading 0)", () => {
    const result = computeRealizedRProgress("LONG", 100, 90, []);
    expect(result.realizedRSoFar).toBeNull();
    expect(result.proportionClosed.toNumber()).toBe(0);
    expect(result.remainingProportion.toNumber()).toBe(100);
    expect(result.isFullyClosed).toBe(false);
  });

  it("returns null when the initial risk distance is invalid (stop on the wrong side / equal to entry)", () => {
    const result = computeRealizedRProgress("LONG", 100, 100, [{ price: 110, proportion: 100 }]);
    expect(result.realizedRSoFar).toBeNull();
    expect(result.isFullyClosed).toBe(false);
  });

  it("treats a single 100%-proportion exit as the fully-closed case", () => {
    const result = computeRealizedRProgress("LONG", 100, 90, [{ price: 105, proportion: 100 }]);
    expect(result.realizedRSoFar?.toNumber()).toBeCloseTo(0.5, 6);
    expect(result.isFullyClosed).toBe(true);
  });
});
