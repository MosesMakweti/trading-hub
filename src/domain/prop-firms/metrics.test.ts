import { describe, expect, it } from "vitest";

import {
  accountRoiPercent,
  accountTotalCosts,
  aggregateAccounts,
  challengePassRatePercent,
  isFundedStageType,
  netPropFirmProfit,
  traderInvestmentRoiPercent,
  type AccountRollupInput,
} from "@/domain/prop-firms/metrics";

describe("accountTotalCosts", () => {
  it("sums challenge fee (net of discount) plus reset/activation/other, treating missing fields as 0", () => {
    expect(
      accountTotalCosts({ purchasePrice: 500, discount: 50, resetFees: 80, activationFees: null, otherCosts: 20 }),
    ).toBe(550);
    expect(
      accountTotalCosts({ purchasePrice: null, discount: null, resetFees: null, activationFees: null, otherCosts: null }),
    ).toBe(0);
  });

  it("never goes negative even if the discount exceeds the price", () => {
    expect(accountTotalCosts({ purchasePrice: 100, discount: 500, resetFees: 0, activationFees: 0, otherCosts: 0 })).toBe(0);
  });
});

describe("accountRoiPercent", () => {
  it("computes PnL / starting balance × 100", () => {
    expect(accountRoiPercent(5_000, 100_000)).toBe(5);
    expect(accountRoiPercent(-2_000, 100_000)).toBe(-2);
  });

  it("is null (not 0 or Infinity) when there is no starting balance to divide by", () => {
    expect(accountRoiPercent(500, 0)).toBeNull();
    expect(accountRoiPercent(500, -100)).toBeNull();
  });
});

describe("netPropFirmProfit / traderInvestmentRoiPercent", () => {
  it("is payouts minus costs, and null ROI when there are no costs (never a fabricated 0% or Infinity)", () => {
    expect(netPropFirmProfit(1_000, 600)).toBe(400);
    expect(traderInvestmentRoiPercent(400, 600)).toBeCloseTo(66.666, 2);
    expect(traderInvestmentRoiPercent(0, 0)).toBeNull();
  });
});

describe("challengePassRatePercent", () => {
  it("is null when nothing has resolved yet", () => {
    expect(challengePassRatePercent(0, 0)).toBeNull();
    expect(challengePassRatePercent(3, 4)).toBe(75);
  });
});

describe("isFundedStageType", () => {
  it("treats only MASTER_FUNDED/PAYOUT_ELIGIBLE as funded", () => {
    expect(isFundedStageType("MASTER_FUNDED")).toBe(true);
    expect(isFundedStageType("PAYOUT_ELIGIBLE")).toBe(true);
    expect(isFundedStageType("PHASE_2")).toBe(false);
  });
});

const account = (over: Partial<AccountRollupInput>): AccountRollupInput => ({
  status: "ACTIVE",
  startingBalance: 100_000,
  currentBalance: 100_000,
  purchasePrice: 500,
  discount: null,
  resetFees: null,
  activationFees: null,
  otherCosts: null,
  paidPayoutsTotal: 0,
  currentStageType: "PHASE_1",
  ...over,
});

describe("aggregateAccounts", () => {
  it("counts active challenges vs funded, at-risk, and breached correctly", () => {
    const rollup = aggregateAccounts([
      account({ currentBalance: 95_000, currentStageType: "PHASE_1" }), // active, at risk (below starting)
      account({ status: "FUNDED", currentBalance: 105_000, currentStageType: "MASTER_FUNDED" }),
      account({ status: "BREACHED", currentBalance: 80_000 }),
      account({ currentBalance: 100_000, currentStageType: "MASTER_FUNDED" }), // active + funded stage
    ]);

    expect(rollup.accountCount).toBe(4);
    expect(rollup.activeAccountCount).toBe(2);
    expect(rollup.activeChallengeCount).toBe(1);
    expect(rollup.fundedCount).toBe(2); // one ACTIVE-but-funded-stage + one FUNDED-status
    expect(rollup.atRiskCount).toBe(1);
    expect(rollup.breachedCount).toBe(1);
  });

  it("sums combined balances, costs, payouts, and derives profit/ROI safely", () => {
    const rollup = aggregateAccounts([
      account({ startingBalance: 100_000, currentBalance: 110_000, purchasePrice: 500, paidPayoutsTotal: 800 }),
      account({ startingBalance: 50_000, currentBalance: 48_000, purchasePrice: 300, paidPayoutsTotal: 0 }),
    ]);

    expect(rollup.combinedCurrentBalance).toBe(158_000);
    expect(rollup.netTradingPnl).toBe(8_000); // +10k, -2k
    expect(rollup.totalCosts).toBe(800);
    expect(rollup.totalPayoutsReceived).toBe(800);
    expect(rollup.netPropFirmProfit).toBe(0);
    expect(rollup.accountRoiPercent).toBeCloseTo((8_000 / 150_000) * 100, 5);
  });

  it("returns null ROI/investment-ROI for an empty or cost-free set instead of NaN", () => {
    const empty = aggregateAccounts([]);
    expect(empty.accountRoiPercent).toBeNull();
    expect(empty.traderInvestmentRoiPercent).toBeNull();
    expect(empty.accountCount).toBe(0);
  });
});
