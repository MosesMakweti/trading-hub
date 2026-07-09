import { describe, expect, it } from "vitest";

import {
  averageLoser,
  averageRR,
  averageTradesPerDay,
  averageWinner,
  expectancy,
  longestLossStreak,
  longestWinStreak,
  monthlyReturns,
  mostTradedAsset,
  profitFactor,
  statsByAsset,
  winRate,
  type TradeMetricInput,
} from "./metrics";

const T = (dateKey: string, assetSymbol: string, actualRR: number | null): TradeMetricInput => ({
  dateKey,
  assetSymbol,
  actualRR,
});

const MIXED: TradeMetricInput[] = [
  T("2026-01-01", "XAUUSD", 2),
  T("2026-01-02", "XAUUSD", -1),
  T("2026-01-03", "EURUSD", 3),
  T("2026-01-04", "EURUSD", -1),
  T("2026-01-05", "EURUSD", null), // still open
];

describe("winRate", () => {
  it("computes % of closed trades that were winners", () => {
    expect(winRate(MIXED)).toBe(50); // 2 of 4 closed
  });

  it("returns null when there are no closed trades", () => {
    expect(winRate([T("2026-01-01", "XAUUSD", null)])).toBeNull();
  });
});

describe("averageRR / averageWinner / averageLoser", () => {
  it("averages only closed trades", () => {
    expect(averageRR(MIXED)).toBeCloseTo((2 - 1 + 3 - 1) / 4);
  });

  it("averages winners and losers separately", () => {
    expect(averageWinner(MIXED)).toBeCloseTo(2.5);
    expect(averageLoser(MIXED)).toBeCloseTo(-1);
  });
});

describe("profitFactor", () => {
  it("computes gross win / gross loss magnitude", () => {
    expect(profitFactor(MIXED)).toBeCloseTo(5 / 2);
  });

  it("returns null when there are no losses", () => {
    expect(profitFactor([T("2026-01-01", "XAUUSD", 2)])).toBeNull();
  });
});

describe("expectancy", () => {
  it("equals averageRR in R-multiple terms (mathematical identity)", () => {
    expect(expectancy(MIXED)).toBeCloseTo(averageRR(MIXED)!);
  });
});

describe("longestWinStreak / longestLossStreak", () => {
  it("finds the longest consecutive run in chronological order", () => {
    const trades = [
      T("2026-01-01", "A", 1),
      T("2026-01-02", "A", 1),
      T("2026-01-03", "A", -1),
      T("2026-01-04", "A", 1),
      T("2026-01-05", "A", 1),
      T("2026-01-06", "A", 1),
    ];
    expect(longestWinStreak(trades)).toBe(3);
    expect(longestLossStreak(trades)).toBe(1);
  });

  it("is order-independent of input array order (sorts by date internally)", () => {
    const trades = [
      T("2026-01-03", "A", -1),
      T("2026-01-01", "A", 1),
      T("2026-01-02", "A", 1),
    ];
    expect(longestWinStreak(trades)).toBe(2);
  });

  it("breakeven trades break a streak", () => {
    const trades = [T("2026-01-01", "A", 1), T("2026-01-02", "A", 0), T("2026-01-03", "A", 1)];
    expect(longestWinStreak(trades)).toBe(1);
  });
});

describe("mostTradedAsset", () => {
  it("returns the asset with the highest trade count", () => {
    expect(mostTradedAsset(MIXED)).toEqual({ assetSymbol: "EURUSD", count: 3 });
  });

  it("returns null for an empty list", () => {
    expect(mostTradedAsset([])).toBeNull();
  });
});

describe("averageTradesPerDay", () => {
  it("divides trade count by range days", () => {
    expect(averageTradesPerDay(MIXED, 5)).toBeCloseTo(1);
  });

  it("returns 0 for a non-positive range", () => {
    expect(averageTradesPerDay(MIXED, 0)).toBe(0);
  });
});

describe("statsByAsset", () => {
  it("groups by asset and sorts by total return descending", () => {
    const stats = statsByAsset(MIXED);
    expect(stats[0].assetSymbol).toBe("EURUSD"); // 3 - 1 = +2
    expect(stats[0].totalReturnPercent).toBeCloseTo(2);
    expect(stats[1].assetSymbol).toBe("XAUUSD"); // 2 - 1 = +1
    expect(stats[1].totalReturnPercent).toBeCloseTo(1);
    expect(stats[0].totalTrades).toBe(3);
    expect(stats[1].totalTrades).toBe(2);
  });
});

describe("monthlyReturns", () => {
  it("sums daily percents into monthly buckets, sorted chronologically", () => {
    const result = monthlyReturns([
      { dateKey: "2026-02-01", percent: 1 },
      { dateKey: "2026-01-15", percent: 2 },
      { dateKey: "2026-01-20", percent: -1 },
    ]);
    expect(result).toEqual([
      { month: "2026-01", percent: 1 },
      { month: "2026-02", percent: 1 },
    ]);
  });
});
