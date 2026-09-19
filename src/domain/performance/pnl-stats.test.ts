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
});

describe("recoveryFactor", () => {
  it("is net profit over max drawdown", () => {
    expect(recoveryFactor(13000, 6500)).toBe(2);
  });
  it("is null when there is no drawdown", () => {
    expect(recoveryFactor(5000, 0)).toBeNull();
  });
});
