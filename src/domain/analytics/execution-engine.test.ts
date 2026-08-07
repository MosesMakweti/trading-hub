import { describe, expect, it } from "vitest";

import {
  buildDiscrepancyCurve,
  scoreTrade,
  summarizeDiscrepancy,
  type ExecutionTradeInput,
} from "./execution-engine";

const trade = (over: Partial<ExecutionTradeInput>): ExecutionTradeInput => ({
  tradeNumber: 1,
  dateKey: "2026-01-01",
  strategyExpectancyR: 1.5,
  executionScore: 100,
  actualR: 1.5,
  ...over,
});

describe("scoreTrade", () => {
  it("matches the spec worked example (1.5R × 90% → 1.35R expected, 0.75R gap)", () => {
    const r = scoreTrade(trade({ strategyExpectancyR: 1.5, executionScore: 90, actualR: 0.6 }));
    expect(r.expectedR).toBe(1.35);
    expect(r.actualR).toBe(0.6);
    expect(r.gapR).toBe(0.75); // 1.35 − 0.60
    expect(r.recoverableR).toBe(0.9); // 1.5 − 0.60 (edge vs perfect execution)
  });

  it("cannot benchmark a trade without expectancy or execution score", () => {
    expect(scoreTrade(trade({ strategyExpectancyR: null })).expectedR).toBeNull();
    expect(scoreTrade(trade({ executionScore: null })).expectedR).toBeNull();
    // actualR still reported even when unbenchmarked
    expect(scoreTrade(trade({ executionScore: null, actualR: 0.4 })).actualR).toBe(0.4);
  });
});

describe("buildDiscrepancyCurve", () => {
  it("accumulates expected vs actual equity per trade, ordered by trade number", () => {
    const curve = buildDiscrepancyCurve([
      trade({ tradeNumber: 2, strategyExpectancyR: 2, executionScore: 50, actualR: 0.5 }),
      trade({ tradeNumber: 1, strategyExpectancyR: 2, executionScore: 100, actualR: 2 }),
    ]);
    expect(curve.map((p) => p.tradeNumber)).toEqual([1, 2]);
    // trade 1: expected 2.0, actual 2.0 ; trade 2: expected +1.0 → 3.0, actual +0.5 → 2.5
    expect(curve[1]).toMatchObject({
      expectedEquity: 3,
      actualEquity: 2.5,
      fullPotentialEquity: 4,
      gap: 0.5,
    });
  });
});

describe("summarizeDiscrepancy", () => {
  it("derives efficiency, edge capture, recoverable, and averages", () => {
    const s = summarizeDiscrepancy([
      trade({ tradeNumber: 1, strategyExpectancyR: 1, executionScore: 100, actualR: 1 }),
      trade({ tradeNumber: 2, strategyExpectancyR: 1, executionScore: 50, actualR: 0.25 }),
    ]);
    // expected = 1 + 0.5 = 1.5 ; actual = 1 + 0.25 = 1.25 ; full potential = 2
    expect(s.expectedEquity).toBe(1.5);
    expect(s.actualEquity).toBe(1.25);
    expect(s.fullPotentialEquity).toBe(2);
    expect(s.currentGap).toBe(0.25);
    expect(s.executionEfficiencyPercent).toBeCloseTo(83.3, 1); // 1.25 / 1.5
    expect(s.edgeCapturePercent).toBeCloseTo(62.5, 1); // 1.25 / 2
    expect(s.recoverableR).toBe(0.75); // 2 − 1.25
    expect(s.averageExecutionScore).toBe(75); // (100 + 50) / 2
  });

  it("measures best/worst execution streaks", () => {
    const s = summarizeDiscrepancy([
      trade({ tradeNumber: 1, executionScore: 95 }),
      trade({ tradeNumber: 2, executionScore: 88 }),
      trade({ tradeNumber: 3, executionScore: 50 }),
      trade({ tradeNumber: 4, executionScore: 40 }),
      trade({ tradeNumber: 5, executionScore: 60 }),
    ]);
    expect(s.bestExecutionStreak).toBe(2); // 95, 88 (≥80)
    expect(s.worstExecutionStreak).toBe(3); // 50, 40, 60 (<65)
  });

  it("classifies the gap trend as growing when execution decays", () => {
    // Early trades near-perfect, later trades leak a lot of edge → gap grows.
    const s = summarizeDiscrepancy([
      trade({ tradeNumber: 1, executionScore: 100, actualR: 1.5 }),
      trade({ tradeNumber: 2, executionScore: 100, actualR: 1.5 }),
      trade({ tradeNumber: 3, executionScore: 90, actualR: 0.2 }),
      trade({ tradeNumber: 4, executionScore: 90, actualR: 0.1 }),
    ]);
    expect(s.gapTrend).toBe("growing");
  });

  it("is empty-safe", () => {
    const s = summarizeDiscrepancy([]);
    expect(s).toMatchObject({ trades: 0, expectedEquity: 0, currentGap: 0, gapTrend: "stable" });
    expect(s.executionEfficiencyPercent).toBeNull();
  });
});
