// Statistical expectancy of a strategy, computed from its own qualifying realized
// trades — the honest benchmark for "Expected Statistical Equity" (System A of the
// discrepancy model). Expectancy is a per-trade average over a large-enough sample;
// it is NEVER the predicted result of the next individual trade.
//
//   Expectancy = (winRate × avgWin) + (lossRate × avgLoss)   [avgLoss is negative]
//              = mean(realized R)                              [equivalent]
//
// Below the minimum sample the statistics are not trustworthy → `sufficient=false`,
// and callers must fall back to a user-entered backtest number or mark the benchmark
// INSUFFICIENT_SAMPLE rather than fabricate one.
//
// Pure + framework-free.

/** Minimum qualifying trades before a computed expectancy is considered reliable. */
export const MIN_EXPECTANCY_SAMPLE = 20;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ExpectancyStats {
  sampleSize: number;
  winRate: number | null; // 0–100
  avgWinR: number | null; // mean of winning R (> 0)
  avgLossR: number | null; // mean of losing R (< 0)
  expectancyR: number | null; // mean R per trade
  sufficient: boolean; // sampleSize ≥ MIN_EXPECTANCY_SAMPLE
}

/**
 * Compute expectancy statistics from an array of realized R multiples (one per
 * qualifying trade). Breakeven (0R) trades count toward the sample and expectancy
 * but are neither wins nor losses.
 */
export function computeExpectancy(
  rs: number[],
  minSample: number = MIN_EXPECTANCY_SAMPLE,
): ExpectancyStats {
  const sampleSize = rs.length;
  if (sampleSize === 0) {
    return { sampleSize: 0, winRate: null, avgWinR: null, avgLossR: null, expectancyR: null, sufficient: false };
  }

  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const decided = wins.length + losses.length;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    sampleSize,
    winRate: decided > 0 ? round2((wins.length / decided) * 100) : null,
    avgWinR: wins.length > 0 ? round2(mean(wins)) : null,
    avgLossR: losses.length > 0 ? round2(mean(losses)) : null,
    expectancyR: round2(mean(rs)),
    sufficient: sampleSize >= minSample,
  };
}

export type ExpectancySource = "LIVE" | "BACKTESTED" | "INSUFFICIENT_SAMPLE";

export interface ResolvedExpectancy {
  expectancyR: number | null;
  source: ExpectancySource;
  sampleSize: number;
}

/**
 * Resolve the expectancy to use for a strategy: prefer a sufficient LIVE sample,
 * else the user's BACKTESTED number if provided, else INSUFFICIENT_SAMPLE (no
 * fabricated benchmark).
 */
export function resolveExpectancy(
  live: ExpectancyStats,
  backtested: number | null,
): ResolvedExpectancy {
  if (live.sufficient && live.expectancyR != null) {
    return { expectancyR: live.expectancyR, source: "LIVE", sampleSize: live.sampleSize };
  }
  if (backtested != null) {
    return { expectancyR: backtested, source: "BACKTESTED", sampleSize: live.sampleSize };
  }
  return { expectancyR: null, source: "INSUFFICIENT_SAMPLE", sampleSize: live.sampleSize };
}
