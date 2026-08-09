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
  });

  it("is zero for a monotonically rising series", () => {
    expect(maxDrawdown([100, 110, 120])).toEqual({ amount: 0, percent: 0 });
  });

  it("handles an empty series", () => {
    expect(maxDrawdown([])).toEqual({ amount: 0, percent: 0 });
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
