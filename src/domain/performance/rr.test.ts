import { describe, expect, it } from "vitest";

import {
  buildEquityCurve,
  calendarColorForPercent,
  dailyPercentFromTrades,
  tradeContributionPercent,
} from "./rr";

describe("tradeContributionPercent", () => {
  it("returns the actual RR as a percent", () => {
    expect(tradeContributionPercent(2.3)).toBe(2.3);
    expect(tradeContributionPercent(-1)).toBe(-1);
  });

  it("returns 0 for open trades (actualRR is null)", () => {
    expect(tradeContributionPercent(null)).toBe(0);
  });
});

describe("dailyPercentFromTrades", () => {
  it("sums contributions across all trades for the day", () => {
    expect(
      dailyPercentFromTrades([{ actualRR: 2 }, { actualRR: -1 }, { actualRR: 0.5 }]),
    ).toBe(1.5);
  });

  it("treats open trades as 0 contribution but still counts nothing negative", () => {
    expect(dailyPercentFromTrades([{ actualRR: 2 }, { actualRR: null }])).toBe(2);
  });

  it("returns 0 for an empty day", () => {
    expect(dailyPercentFromTrades([])).toBe(0);
  });
});

describe("calendarColorForPercent", () => {
  it("is gray when there are no trades, regardless of percent", () => {
    expect(calendarColorForPercent(0, 0)).toBe("gray");
  });

  it("is gray for a breakeven day with trades", () => {
    expect(calendarColorForPercent(0, 2)).toBe("gray");
  });

  it("is green for a profitable day", () => {
    expect(calendarColorForPercent(3.2, 3)).toBe("green");
  });

  it("is red for a losing day", () => {
    expect(calendarColorForPercent(-1.4, 1)).toBe("red");
  });
});

describe("buildEquityCurve", () => {
  it("compounds daily percents chronologically regardless of input order", () => {
    const curve = buildEquityCurve([
      { dateKey: "2026-01-02", percent: 10 },
      { dateKey: "2026-01-01", percent: 10 },
    ]);

    expect(curve.map((p) => p.dateKey)).toEqual(["2026-01-01", "2026-01-02"]);
    // day 1: 100 -> 110 (+10%); day 2: 110 -> 121 (+10% of 110)
    expect(curve[0].cumulativeCompounding).toBeCloseTo(10);
    expect(curve[1].cumulativeCompounding).toBeCloseTo(21);
  });

  it("tracks simple additive cumulative alongside compounding", () => {
    const curve = buildEquityCurve([
      { dateKey: "2026-01-01", percent: 5 },
      { dateKey: "2026-01-02", percent: -2 },
    ]);

    expect(curve[1].cumulativeAdditive).toBeCloseTo(3);
    // compounding: 100 -> 105 -> 105 * 0.98 = 102.9 -> +2.9%
    expect(curve[1].cumulativeCompounding).toBeCloseTo(2.9);
  });

  it("returns an empty array for no data", () => {
    expect(buildEquityCurve([])).toEqual([]);
  });
});
