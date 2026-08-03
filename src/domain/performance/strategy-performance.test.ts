import { describe, expect, it } from "vitest";

import {
  summarizeStrategyPerformance,
  type StrategyTradePoint,
} from "@/domain/performance/strategy-performance";

const t = (
  actualRR: number | null,
  psychologyPercent: number | null = null,
  adherencePercent: number | null = null,
  dateKey = "2026-08-03",
): StrategyTradePoint => ({ dateKey, assetSymbol: "EURUSD", actualRR, psychologyPercent, adherencePercent });

describe("summarizeStrategyPerformance", () => {
  it("returns an empty-but-defined summary for no trades", () => {
    const s = summarizeStrategyPerformance([]);
    expect(s).toMatchObject({
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: null,
      averageRR: null,
      totalRR: 0,
      profitFactor: null,
      bestRR: null,
      worstRR: null,
      averagePsychologyPercent: null,
      averageAdherencePercent: null,
    });
  });

  it("computes win rate, averages, totals and extremes", () => {
    // +2, +1, -1  => 2 wins / 3 = 66.67%, total 2, best 2, worst -1
    const s = summarizeStrategyPerformance([t(2), t(1), t(-1)]);
    expect(s.totalTrades).toBe(3);
    expect(s.winningTrades).toBe(2);
    expect(s.losingTrades).toBe(1);
    expect(s.winRate).toBeCloseTo((2 / 3) * 100, 5);
    expect(s.averageRR).toBeCloseTo(2 / 3, 5);
    expect(s.totalRR).toBe(2);
    expect(s.bestRR).toBe(2);
    expect(s.worstRR).toBe(-1);
    // gross win 3 / gross loss 1 = 3
    expect(s.profitFactor).toBe(3);
  });

  it("averages psychology and adherence over only the trades that have them", () => {
    const s = summarizeStrategyPerformance([
      t(1, 80, 100),
      t(-1, 60, null),
      t(2, null, 50),
    ]);
    expect(s.averagePsychologyPercent).toBe(70); // (80+60)/2
    expect(s.averageAdherencePercent).toBe(75); // (100+50)/2
  });

  it("tracks longest win and loss streaks in date order", () => {
    const s = summarizeStrategyPerformance([
      t(1, null, null, "2026-08-01"),
      t(2, null, null, "2026-08-02"),
      t(-1, null, null, "2026-08-03"),
      t(-2, null, null, "2026-08-04"),
      t(-1, null, null, "2026-08-05"),
      t(1, null, null, "2026-08-06"),
    ]);
    expect(s.longestWinStreak).toBe(2);
    expect(s.longestLossStreak).toBe(3);
  });
});
