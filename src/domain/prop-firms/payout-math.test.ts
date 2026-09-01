import { describe, expect, it } from "vitest";

import {
  computePayoutSplit,
  propFirmShareFromSnapshot,
  roundCurrency,
  traderReceivedFromSnapshot,
} from "./payout-math";

describe("computePayoutSplit", () => {
  it("computes the spec's worked example exactly ($220.58 @ 80%)", () => {
    const result = computePayoutSplit(220.58, 80);
    expect(result.traderPayout).toBe("176.46"); // 176.464 -> 176.46
    expect(result.propFirmShare).toBe("44.12"); // 220.58 - 176.46
  });

  it("computes the other worked example ($5000 @ 80%)", () => {
    const result = computePayoutSplit(5000, 80);
    expect(result.traderPayout).toBe("4000");
    expect(result.propFirmShare).toBe("1000");
  });

  it("always sums back to the gross withdrawal", () => {
    const result = computePayoutSplit(1234.56, 73.5);
    const sum = Number(result.traderPayout) + Number(result.propFirmShare);
    expect(sum).toBeCloseTo(1234.56, 2);
  });

  it("treats the withdrawal amount as absolute (sign-insensitive)", () => {
    expect(computePayoutSplit(-5000, 80)).toEqual(computePayoutSplit(5000, 80));
  });

  it("handles a 100% split", () => {
    expect(computePayoutSplit(1000, 100)).toEqual({ traderPayout: "1000", propFirmShare: "0" });
  });

  it("handles a 0% split", () => {
    expect(computePayoutSplit(1000, 0)).toEqual({ traderPayout: "0", propFirmShare: "1000" });
  });
});

describe("snapshot-derived totals", () => {
  it("uses netReceived when present, ignoring the percent", () => {
    expect(traderReceivedFromSnapshot({ grossPayout: 220.58, profitSplitPercent: 80, netReceived: 200 })).toBe(200);
  });

  it("derives from the snapshotted percent when netReceived is absent", () => {
    expect(traderReceivedFromSnapshot({ grossPayout: 220.58, profitSplitPercent: 80, netReceived: null })).toBe(176.46);
    expect(propFirmShareFromSnapshot({ grossPayout: 220.58, profitSplitPercent: 80, netReceived: null })).toBe(44.12);
  });

  it("reports no firm share when no percent was ever snapshotted", () => {
    expect(traderReceivedFromSnapshot({ grossPayout: 500, profitSplitPercent: null, netReceived: null })).toBe(500);
    expect(propFirmShareFromSnapshot({ grossPayout: 500, profitSplitPercent: null, netReceived: null })).toBeNull();
  });

  it("roundCurrency rounds half up to 2dp", () => {
    expect(roundCurrency(176.464)).toBe(176.46);
    expect(roundCurrency(176.465)).toBe(176.47);
  });
});
