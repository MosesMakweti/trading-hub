import { describe, expect, it } from "vitest";

import {
  averagePsychologyGrade,
  averagePsychologyPercent,
  averagePsychologyScore,
  bestMonth,
  byAccount,
  byAsset,
  byDay,
  byDayOfWeek,
  bySession,
  correlationWithProfitability,
  correlationWithRuleAdherence,
  correlationWithWinRate,
  pearsonCorrelation,
  trendByMonth,
  trendByWeek,
  worstMonth,
  type PsychologyDataPoint,
} from "./analytics";

const P = (overrides: Partial<PsychologyDataPoint>): PsychologyDataPoint => ({
  dateKey: "2026-01-01",
  percent: 50,
  rawScore: 0,
  assetSymbol: "XAUUSD",
  accountName: "Live 1",
  sessionName: "London",
  actualRR: null,
  ruleAdherencePercent: null,
  ...overrides,
});

describe("averages", () => {
  const points = [P({ percent: 100, rawScore: 8 }), P({ percent: 50, rawScore: 0 })];

  it("averages percent and raw score", () => {
    expect(averagePsychologyPercent(points)).toBe(75);
    expect(averagePsychologyScore(points)).toBe(4);
  });

  it("derives grade from average percent", () => {
    expect(averagePsychologyGrade(points)).toBe("C"); // average is 75%, which is a C (70-79%)
  });

  it("returns null for an empty set", () => {
    expect(averagePsychologyPercent([])).toBeNull();
    expect(averagePsychologyGrade([])).toBeNull();
  });
});

describe("trendByMonth / bestMonth / worstMonth", () => {
  const points = [
    P({ dateKey: "2026-01-05", percent: 90 }),
    P({ dateKey: "2026-01-20", percent: 70 }),
    P({ dateKey: "2026-02-10", percent: 40 }),
  ];

  it("groups by month and averages", () => {
    const trend = trendByMonth(points);
    expect(trend).toEqual([
      { key: "2026-01", averagePercent: 80, count: 2 },
      { key: "2026-02", averagePercent: 40, count: 1 },
    ]);
  });

  it("finds the best and worst month", () => {
    expect(bestMonth(points)?.key).toBe("2026-01");
    expect(worstMonth(points)?.key).toBe("2026-02");
  });

  it("returns null best/worst month for no data", () => {
    expect(bestMonth([])).toBeNull();
    expect(worstMonth([])).toBeNull();
  });
});

describe("trendByWeek", () => {
  it("keys by the Monday of each ISO week", () => {
    // 2026-01-07 is a Wednesday; that week's Monday is 2026-01-05
    const trend = trendByWeek([P({ dateKey: "2026-01-07", percent: 60 })]);
    expect(trend).toEqual([{ key: "2026-01-05", averagePercent: 60, count: 1 }]);
  });
});

describe("breakdowns", () => {
  const points = [
    P({ assetSymbol: "XAUUSD", accountName: "Live 1", sessionName: "London", percent: 80 }),
    P({ assetSymbol: "EURUSD", accountName: "Live 2", sessionName: "NY", percent: 40 }),
    P({ assetSymbol: "XAUUSD", accountName: "Live 1", sessionName: "London", percent: 60 }),
  ];

  it("breaks down by asset", () => {
    const result = byAsset(points);
    expect(result.find((r) => r.key === "XAUUSD")).toEqual({
      key: "XAUUSD",
      averagePercent: 70,
      count: 2,
    });
  });

  it("breaks down by account", () => {
    expect(byAccount(points).find((r) => r.key === "Live 2")).toEqual({
      key: "Live 2",
      averagePercent: 40,
      count: 1,
    });
  });

  it("breaks down by session, grouping missing sessions", () => {
    const withNoSession = [...points, P({ sessionName: null, percent: 20 })];
    expect(bySession(withNoSession).find((r) => r.key === "No session")).toEqual({
      key: "No session",
      averagePercent: 20,
      count: 1,
    });
  });

  it("breaks down by day of week in Sun-Sat order", () => {
    // 2026-01-01 is a Thursday
    const result = byDayOfWeek([P({ dateKey: "2026-01-01" })]);
    expect(result.map((r) => r.key)).toContain("Thu");
  });

  it("breaks down by day, averaging multiple trades on the same day", () => {
    const sameDay = [P({ dateKey: "2026-01-01", percent: 80 }), P({ dateKey: "2026-01-01", percent: 60 })];
    expect(byDay(sameDay)).toEqual([{ key: "2026-01-01", averagePercent: 70, count: 2 }]);
  });
});

describe("pearsonCorrelation", () => {
  it("is 1 for a perfect positive linear relationship", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });

  it("is -1 for a perfect negative linear relationship", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });

  it("is null when either series has zero variance", () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("is null with fewer than 2 pairs", () => {
    expect(pearsonCorrelation([1], [1])).toBeNull();
  });
});

describe("correlation helpers", () => {
  it("correlates psychology% with profitability (actualRR) for closed trades only", () => {
    const points = [
      P({ percent: 90, actualRR: 2 }),
      P({ percent: 10, actualRR: -2 }),
      P({ percent: 50, actualRR: null }), // excluded
    ];
    expect(correlationWithProfitability(points)).toBeCloseTo(1);
  });

  it("correlates psychology% with win/loss as a binary outcome", () => {
    const points = [
      P({ percent: 90, actualRR: 1 }),
      P({ percent: 10, actualRR: -1 }),
    ];
    expect(correlationWithWinRate(points)).toBeCloseTo(1);
  });

  it("correlates psychology% with rule adherence%", () => {
    const points = [
      P({ percent: 90, ruleAdherencePercent: 100 }),
      P({ percent: 10, ruleAdherencePercent: 0 }),
    ];
    expect(correlationWithRuleAdherence(points)).toBeCloseTo(1);
  });
});
