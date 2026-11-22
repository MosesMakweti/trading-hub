import { describe, expect, it } from "vitest";

import { wc } from "@/domain/native-replay/testing/m1-fixtures";
import { computeSetupStats, groupStats, hourBucketOf, sampleQuality, weekdayOf, type StatRow } from "./study-stats";

const ex = (r: number | null, minute: number): StatRow => ({ executed: true, r, outcome: r == null ? "UNRESOLVED" : r > 0 ? "WIN" : r < 0 ? "LOSS" : "BREAKEVEN", minute });

describe("setup statistics", () => {
  it("computes the executed metrics by hand: +2, −1, +1.5, −1, 0, (open)", () => {
    const s = computeSetupStats([ex(2, 1), ex(-1, 2), ex(1.5, 3), ex(-1, 4), ex(0, 5), ex(null, 6)]);
    expect(s).toMatchObject({ occurrences: 6, executed: 6, resolved: 5, wins: 2, losses: 2, breakevens: 1, longestWinStreak: 1, longestLossStreak: 1, sample: "INSUFFICIENT" });
    expect(s.winRate).toBeCloseTo(40);
    expect(s.netR).toBeCloseTo(1.5);
    expect(s.expectancy).toBeCloseTo(0.3);
    expect(s.profitFactor).toBeCloseTo(3.5 / 2);
    expect(s.averageWinR).toBeCloseTo(1.75);
    expect(s.averageLossR).toBeCloseTo(-1);
    expect(s.averageRewardRisk).toBeCloseTo(1.75);
    // Cumulative 2, 1, 2.5, 1.5, 1.5 → peak 2.5, trough 1.5 → −1.
    expect(s.maxDrawdownR).toBeCloseTo(-1);
  });

  it("orders by replay time for drawdown and streaks, not by input order", () => {
    const s = computeSetupStats([ex(-1, 30), ex(-1, 20), ex(3, 10)]);
    expect(s.longestLossStreak).toBe(2);
    expect(s.maxDrawdownR).toBeCloseTo(-2);
  });

  it("keeps self-reported results out of executed stats", () => {
    const s = computeSetupStats([
      ex(1, 1),
      { executed: false, r: 3, outcome: "WIN", minute: 2 },
      { executed: false, r: -1, outcome: "LOSS", minute: 3 },
      { executed: false, r: null, outcome: "UNRESOLVED", minute: 4 },
    ]);
    expect(s).toMatchObject({ occurrences: 4, executed: 1, notExecuted: 3, resolved: 1, netR: 1, selfReported: { count: 2, wins: 1, losses: 1, netR: 2 } });
  });

  it("reports no ratios without a resolved trade, and labels the sample size", () => {
    const s = computeSetupStats([{ executed: false, r: null, outcome: "UNRESOLVED", minute: 1 }]);
    expect(s).toMatchObject({ winRate: null, profitFactor: null, expectancy: null, maxDrawdownR: null, sample: "NONE" });
    expect([0, 1, 9, 10, 29, 30].map(sampleQuality)).toEqual(["NONE", "INSUFFICIENT", "INSUFFICIENT", "LOW", "LOW", "ADEQUATE"]);
  });

  it("groups by key with the largest groups first", () => {
    const rows = [{ ...ex(1, 1), s: "A" }, { ...ex(-1, 2), s: "B" }, { ...ex(2, 3), s: "B" }];
    const g = groupStats(rows, (r) => ({ key: r.s, label: `Setup ${r.s}` }));
    expect(g.map((x) => [x.label, x.stats.occurrences, x.stats.netR])).toEqual([["Setup B", 2, 1], ["Setup A", 1, 1]]);
  });

  it("buckets broker minutes by server-clock hour and weekday", () => {
    expect(hourBucketOf(wc("2024-05-14T09:37"))).toEqual({ key: "09", label: "09:00" });
    expect(weekdayOf(wc("2024-05-14T09:37")).label).toBe("Tuesday");
    expect(weekdayOf(wc("2024-05-12T23:59")).label).toBe("Sunday");
  });
});
