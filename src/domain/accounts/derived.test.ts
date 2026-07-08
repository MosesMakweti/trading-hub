import { describe, expect, it } from "vitest";

import { computeBrokerageMetrics, computePropFirmRoi } from "./derived";

describe("computePropFirmRoi", () => {
  it("computes positive ROI", () => {
    expect(computePropFirmRoi(500, 1500)).toBe(200);
  });

  it("computes negative ROI", () => {
    expect(computePropFirmRoi(500, 0)).toBe(-100);
  });

  it("returns null when purchase cost is missing or zero", () => {
    expect(computePropFirmRoi(null, 100)).toBeNull();
    expect(computePropFirmRoi(0, 100)).toBeNull();
  });

  it("returns null when total payouts is missing", () => {
    expect(computePropFirmRoi(500, null)).toBeNull();
  });
});

describe("computeBrokerageMetrics", () => {
  it("computes net profit, return%, and equity growth with no flows", () => {
    const result = computeBrokerageMetrics({
      startingBalance: 1000,
      currentBalance: 1200,
      totalWithdrawals: 0,
      totalDeposits: 0,
    });
    expect(result.netProfit).toBe(200);
    expect(result.totalReturnPercent).toBe(20);
    expect(result.currentEquityGrowthPercent).toBe(20);
  });

  it("treats withdrawals/deposits as capital flows separate from equity growth", () => {
    const result = computeBrokerageMetrics({
      startingBalance: 1000,
      currentBalance: 900,
      totalWithdrawals: 300,
      totalDeposits: 0,
    });
    // trading profit = 900 - 1000 - 0 + 300 = 200
    expect(result.netProfit).toBe(200);
    expect(result.totalReturnPercent).toBe(20);
    // equity growth compares raw balances only, ignoring withdrawals
    expect(result.currentEquityGrowthPercent).toBe(-10);
  });

  it("returns nulls when starting balance is missing or zero", () => {
    expect(
      computeBrokerageMetrics({
        startingBalance: null,
        currentBalance: 500,
        totalWithdrawals: 0,
        totalDeposits: 0,
      }).netProfit,
    ).toBeNull();

    expect(
      computeBrokerageMetrics({
        startingBalance: 0,
        currentBalance: 500,
        totalWithdrawals: 0,
        totalDeposits: 0,
      }).netProfit,
    ).toBeNull();
  });
});
