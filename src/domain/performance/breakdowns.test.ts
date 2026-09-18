import { describe, expect, it } from "vitest";

import {
  bucketPerf,
  dayOfWeekPerformance,
  longShortPerformance,
  monthlyPerformance,
  rMultipleDistribution,
  riskStats,
  sessionPerformance,
  type AnalyticsTradePoint,
} from "./breakdowns";

const P = (o: Partial<AnalyticsTradePoint>): AnalyticsTradePoint => ({
  dateKey: "2026-01-05",
  monthKey: "2026-01",
  weekday: 1,
  hour: 9,
  pnl: 0,
  actualR: 0,
  direction: "LONG",
  session: null,
  riskPercent: 1,
  ...o,
});

describe("bucketPerf", () => {
  // Stage C.1: every point here is already a settled trade (the caller
  // never pushes a pending one) — a genuine breakeven counts in the win
  // rate denominator like domain/performance/metrics.ts's winRate(), it's
  // just not credited as a win.
  it("computes net pnl, win rate (of all settled trades, breakeven included in the denominator), avg R and expectancy", () => {
    const b = bucketPerf([
      P({ pnl: 100, actualR: 2 }),
      P({ pnl: -50, actualR: -1 }),
      P({ pnl: 0, actualR: 0 }), // genuine breakeven — still a settled, closed trade
    ]);
    expect(b.trades).toBe(3);
    expect(b.netPnl).toBe(50);
    expect(b.winRate).toBeCloseTo(33.333, 2); // 1 win of 3 settled trades
    expect(b.avgR).toBeCloseTo(0.3333, 3);
  });

  it("is null-safe for an empty bucket", () => {
    expect(bucketPerf([])).toEqual({ trades: 0, netPnl: 0, winRate: null, avgR: null, expectancy: null });
  });
});

describe("dayOfWeekPerformance", () => {
  it("groups Monday-first and only returns days with trades", () => {
    const days = dayOfWeekPerformance([
      P({ weekday: 1, pnl: 100 }),
      P({ weekday: 3, pnl: -20 }),
      P({ weekday: 1, pnl: 40 }),
    ]);
    expect(days.map((d) => d.label)).toEqual(["Monday", "Wednesday"]);
    expect(days[0].trades).toBe(2);
    expect(days[0].netPnl).toBe(140);
  });
});

describe("monthlyPerformance", () => {
  it("sorts chronologically and sums return %", () => {
    const months = monthlyPerformance([
      P({ monthKey: "2026-02", actualR: 1.5, pnl: 100 }),
      P({ monthKey: "2026-01", actualR: -0.5, pnl: -30 }),
      P({ monthKey: "2026-02", actualR: 0.5, pnl: 20 }),
    ]);
    expect(months.map((m) => m.monthKey)).toEqual(["2026-01", "2026-02"]);
    expect(months[1].returnPercent).toBeCloseTo(2, 5);
    expect(months[1].trades).toBe(2);
  });
});

describe("longShortPerformance", () => {
  it("splits by direction", () => {
    const [long, short] = longShortPerformance([
      P({ direction: "LONG", pnl: 100 }),
      P({ direction: "SHORT", pnl: -40 }),
    ]);
    expect(long.label).toBe("Long");
    expect(long.netPnl).toBe(100);
    expect(short.netPnl).toBe(-40);
  });
});

describe("sessionPerformance", () => {
  it("groups by session, sorted by net P&L, null → No session", () => {
    const s = sessionPerformance([
      P({ session: "London", pnl: 50 }),
      P({ session: null, pnl: 200 }),
      P({ session: "London", pnl: 30 }),
    ]);
    expect(s[0].label).toBe("No session"); // 200 > 80
    expect(s[1].label).toBe("London");
    expect(s[1].netPnl).toBe(80);
  });
});

describe("rMultipleDistribution", () => {
  it("bins realized R into half-open buckets", () => {
    const dist = rMultipleDistribution([
      P({ actualR: -3.5 }), // ≤ −3R
      P({ actualR: -1 }), // −1…0R
      P({ actualR: 0 }), // 0…1R
      P({ actualR: 2.5 }), // 2…3R
      P({ actualR: 5 }), // ≥ 3R
    ]);
    const by = Object.fromEntries(dist.map((b) => [b.label, b.count]));
    expect(by["≤ −3R"]).toBe(1);
    expect(by["−1…0R"]).toBe(1);
    expect(by["0…1R"]).toBe(1);
    expect(by["2…3R"]).toBe(1);
    expect(by["≥ 3R"]).toBe(1);
    expect(dist.reduce((s, b) => s + b.count, 0)).toBe(5);
  });
});

describe("riskStats", () => {
  it("computes avg / max / consistency, and is high for uniform risk", () => {
    const uniform = riskStats([1, 1, 1, 1]);
    expect(uniform.avgRisk).toBe(1);
    expect(uniform.maxRisk).toBe(1);
    expect(uniform.consistency).toBe(100);

    const varied = riskStats([1, 3]);
    expect(varied.avgRisk).toBe(2);
    expect(varied.consistency).toBeLessThan(100);
  });

  it("is null-safe with no risk data", () => {
    expect(riskStats([])).toEqual({ avgRisk: null, maxRisk: null, stdDev: null, consistency: null });
  });
});
