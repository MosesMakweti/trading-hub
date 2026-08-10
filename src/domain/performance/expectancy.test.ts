import { describe, expect, it } from "vitest";

import { computeExpectancy, resolveExpectancy } from "./expectancy";

describe("computeExpectancy", () => {
  it("matches the spec example (55% win, +2R win, −1R loss → +0.65R)", () => {
    // 11 winners at +2R, 9 losers at −1R = 20 trades, 55% win rate.
    const rs = [...Array(11).fill(2), ...Array(9).fill(-1)];
    const s = computeExpectancy(rs);
    expect(s.sampleSize).toBe(20);
    expect(s.winRate).toBe(55);
    expect(s.avgWinR).toBe(2);
    expect(s.avgLossR).toBe(-1);
    expect(s.expectancyR).toBe(0.65); // (0.55·2)+(0.45·−1)
    expect(s.sufficient).toBe(true);
  });

  it("flags an insufficient sample rather than trusting a tiny one", () => {
    const s = computeExpectancy([2, -1, 2]);
    expect(s.sampleSize).toBe(3);
    expect(s.sufficient).toBe(false);
    expect(s.expectancyR).toBe(1); // still computed, just not "sufficient"
  });

  it("counts breakeven toward the sample but not win/loss", () => {
    const s = computeExpectancy([2, 0, -1, 0]);
    expect(s.sampleSize).toBe(4);
    expect(s.winRate).toBe(50); // 1 win / (1 win + 1 loss)
    expect(s.expectancyR).toBe(0.25); // mean of [2,0,-1,0]
  });

  it("empty sample → all null, not sufficient", () => {
    const s = computeExpectancy([]);
    expect(s.expectancyR).toBeNull();
    expect(s.sufficient).toBe(false);
  });
});

describe("resolveExpectancy — live preferred, backtest fallback, else insufficient", () => {
  const suff = computeExpectancy([...Array(11).fill(2), ...Array(9).fill(-1)]); // sufficient
  const insuff = computeExpectancy([2, -1]); // not sufficient

  it("uses LIVE when the sample is sufficient", () => {
    expect(resolveExpectancy(suff, 0.4)).toMatchObject({ source: "LIVE", expectancyR: 0.65 });
  });

  it("falls back to BACKTESTED when live is insufficient but a backtest exists", () => {
    expect(resolveExpectancy(insuff, 0.4)).toMatchObject({ source: "BACKTESTED", expectancyR: 0.4 });
  });

  it("INSUFFICIENT_SAMPLE when neither is available (no fabricated benchmark)", () => {
    expect(resolveExpectancy(insuff, null)).toMatchObject({ source: "INSUFFICIENT_SAMPLE", expectancyR: null });
  });
});
