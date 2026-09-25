import { describe, expect, it } from "vitest";

import { maxDrawdown, pnlStats, recoveryFactor } from "./pnl-stats";

describe("pnlStats", () => {
  it("splits net / gross / largest / breakeven correctly", () => {
    const s = pnlStats([100, -40, 250, -60, 0, -10]);
    expect(s.netPnl).toBe(240);
    expect(s.grossProfit).toBe(350);
    expect(s.grossLoss).toBe(-110);
    expect(s.largestWin).toBe(250);
    expect(s.largestLoss).toBe(-60);
    expect(s.breakevenTrades).toBe(1);
  });

  it("is all-zero for no trades", () => {
    expect(pnlStats([])).toEqual({
      netPnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      breakevenTrades: 0,
    });
  });
});

describe("maxDrawdown", () => {
  it("finds the largest peak-to-trough decline in amount and percent", () => {
    // peak 100000 → trough 92000 = 8000 (8%)
    const dd = maxDrawdown([100000, 105000, 100000, 92000, 98000, 110000, 104500]);
    // peak 110000 → 104500 = 5500 (5%); earlier peak 105000 → 92000 = 13000 (12.38%)
    expect(dd.amount).toBe(13000);
    expect(dd.percent).toBeCloseTo(12.381, 2);
    expect(dd.series).toHaveLength(7);
  });

  it("is zero for a monotonically rising series", () => {
    const dd = maxDrawdown([100, 110, 120]);
    expect(dd.amount).toBe(0);
    expect(dd.percent).toBe(0);
    expect(dd.currentAmount).toBe(0);
    expect(dd.currentPercent).toBe(0);
  });

  it("handles an empty series", () => {
    const dd = maxDrawdown([]);
    expect(dd.amount).toBe(0);
    expect(dd.percent).toBe(0);
    expect(dd.series).toEqual([]);
  });

  // Analytics V2 §5 — current drawdown is the decline from peak AS OF the
  // last point, distinct from the historical maximum.
  it("current drawdown reflects the LAST point, not the worst historical trough", () => {
    // Worst trough was 92000 (from peak 105000); series ends recovered near peak.
    const dd = maxDrawdown([100000, 105000, 92000, 98000, 110000, 108000]);
    expect(dd.amount).toBeCloseTo(13000, 6); // the historical worst (105000 -> 92000)
    expect(dd.currentAmount).toBeCloseTo(2000, 6); // last point: peak 110000, now 108000
    expect(dd.currentPercent).toBeCloseTo((2000 / 110000) * 100, 6);
  });

  it("current drawdown is zero when the series ends exactly at its peak", () => {
    const dd = maxDrawdown([100, 90, 105]);
    expect(dd.currentAmount).toBe(0);
    expect(dd.currentPercent).toBe(0);
  });

  // Audit fixtures (Analytics V2 correctness pass) — maxDrawdown() is
  // unit-agnostic (the caller decides R vs $), so an R-multiple cumulative
  // curve is a valid input: "do not force R into a percentage-only function."
  it("Audit Fixture C: R curve 0,2,1,4,3,3 — the two 1R peak-to-trough declines (2→1, 4→3), not the largest single trade", () => {
    const dd = maxDrawdown([0, 2, 1, 4, 3, 3]);
    expect(dd.amount).toBe(1);
    // The two declines are both 1R in absolute terms but NOT equal in percent
    // terms — 2→1 is a 50% decline off its peak, 4→3 is only 25% off its
    // peak. `percent` correctly tracks the worse RELATIVE decline (50%),
    // proving it's computed independently of `amount`, not derived from it.
    expect(dd.percent).toBeCloseTo(50, 6);
    expect(dd.currentAmount).toBe(1); // last point: peak 4, now 3
    expect(dd.currentPercent).toBeCloseTo(25, 6);
  });

  it("Audit Fixture D: all-losses R curve 0,-1,-2,-4 never divides by a zero peak", () => {
    const dd = maxDrawdown([0, -1, -2, -4]);
    expect(dd.amount).toBe(4); // peak never exceeds the starting 0
    expect(dd.percent).toBe(0); // decline / 0 is undefined — guarded to 0, never NaN/Infinity
    expect(Number.isFinite(dd.percent)).toBe(true);
    expect(Number.isNaN(dd.percent)).toBe(false);
  });

  it("Audit Fixture E: all-wins R curve 0,1,3,4 has zero drawdown throughout, no NaN/Infinity", () => {
    const dd = maxDrawdown([0, 1, 3, 4]);
    expect(dd.amount).toBe(0);
    expect(dd.percent).toBe(0);
    expect(dd.currentAmount).toBe(0);
    expect(dd.currentPercent).toBe(0);
  });

  it("Audit Fixture F: no trades — a fully-defined, all-zero Drawdown, never null/undefined fields", () => {
    expect(maxDrawdown([])).toEqual({ amount: 0, percent: 0, currentAmount: 0, currentPercent: 0, series: [] });
  });
});

describe("recoveryFactor", () => {
  it("is net profit over max drawdown", () => {
    expect(recoveryFactor(13000, 6500)).toBe(2);
  });
  it("is null when there is no drawdown", () => {
    expect(recoveryFactor(5000, 0)).toBeNull();
  });
});
