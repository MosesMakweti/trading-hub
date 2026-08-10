import { describe, expect, it } from "vitest";

import {
  buildDiscrepancyCurve,
  classifyTrade,
  summarizeDiscrepancy,
  type DiscrepancyTradeInput,
} from "./discrepancy-model";

describe('classifyTrade — driven by "Would I take this trade again?"', () => {
  it("Yes + WIN → NORMAL_WIN, avoidable 0", () => {
    const r = classifyTrade({ actualR: 2, wouldTakeAgain: true });
    expect(r.classification).toBe("NORMAL_WIN");
    expect(r.avoidableR).toBe(0);
    expect(r.processDiscrepancy).toBe(false);
  });

  it("Yes + LOSS → NORMAL_LOSS, avoidable 0 (a losing trade you'd repeat is NOT a discrepancy)", () => {
    const r = classifyTrade({ actualR: -1, wouldTakeAgain: true });
    expect(r.classification).toBe("NORMAL_LOSS");
    expect(r.avoidableR).toBe(0);
    expect(r.processDiscrepancy).toBe(false);
  });

  it("Yes + BREAKEVEN → NORMAL_BREAKEVEN, avoidable 0", () => {
    expect(classifyTrade({ actualR: 0, wouldTakeAgain: true }).classification).toBe("NORMAL_BREAKEVEN");
  });

  it("No + LOSS → PROCESS_DISCREPANCY_LOSS, avoidable 1R", () => {
    const r = classifyTrade({ actualR: -1, wouldTakeAgain: false });
    expect(r.classification).toBe("PROCESS_DISCREPANCY_LOSS");
    expect(r.avoidableR).toBe(1);
    expect(r.processDiscrepancy).toBe(true);
  });

  it("No + WIN → PROCESS_DISCREPANCY_WIN, avoidable 1R (a winning trade you'd NOT repeat still leaks)", () => {
    const r = classifyTrade({ actualR: 3, wouldTakeAgain: false });
    expect(r.classification).toBe("PROCESS_DISCREPANCY_WIN");
    expect(r.avoidableR).toBe(1);
  });

  it("unanswered → UNVERIFIED, avoidable 0 (no fabricated discrepancy)", () => {
    const r = classifyTrade({ actualR: -1, wouldTakeAgain: null });
    expect(r.classification).toBe("UNVERIFIED");
    expect(r.avoidableR).toBe(0);
  });
});

describe("summarizeDiscrepancy — Performance Variance vs Avoidable Discrepancy", () => {
  it("HEADLINE: expectancy +0.65, actual −1, perfect execution → actual −1R, avoidable 0R (NOT +1.65 discrepancy)", () => {
    const inputs: DiscrepancyTradeInput[] = [
      { sequence: 1, dateKey: "2026-01-01", strategyExpectancyR: 0.65, actualR: -1, avoidableR: 0 },
    ];
    const s = summarizeDiscrepancy(inputs);
    expect(s.actualEquity).toBe(-1);
    expect(s.expectedStatisticalEquity).toBe(0.65);
    expect(s.performanceVariance).toBe(1.65); // this is VARIANCE, not error
    expect(s.avoidableDiscrepancyR).toBe(0); // the trader did nothing wrong
    expect(s.normalVarianceR).toBe(1.65);
  });

  it("decomposes total difference into avoidable + normal variance, incl. missed cost", () => {
    const inputs: DiscrepancyTradeInput[] = [
      { sequence: 1, dateKey: "d", strategyExpectancyR: 0.6, actualR: 0.1, avoidableR: 0.3 },
      { sequence: 2, dateKey: "d", strategyExpectancyR: 0.6, actualR: -1, avoidableR: 0 },
    ];
    const s = summarizeDiscrepancy(inputs, 1.5 /* validated missed winner */);
    expect(s.expectedStatisticalEquity).toBe(1.2);
    expect(s.actualEquity).toBe(-0.9);
    expect(s.performanceVariance).toBe(2.1); // 1.2 − (−0.9)
    expect(s.avoidableDiscrepancyR).toBe(1.8); // 0.3 executed + 1.5 missed
    expect(s.normalVarianceR).toBe(0.3); // 2.1 − 1.8
  });

  it("no benchmarked trades → hasBenchmark false (INSUFFICIENT_SAMPLE), variance 0", () => {
    const s = summarizeDiscrepancy([
      { sequence: 1, dateKey: "d", strategyExpectancyR: null, actualR: 2, avoidableR: 0 },
    ]);
    expect(s.hasBenchmark).toBe(false);
    expect(s.expectedStatisticalEquity).toBe(0);
    expect(s.edgeCapturePercent).toBeNull();
    expect(s.actualEquity).toBe(2);
  });
});

describe("buildDiscrepancyCurve", () => {
  it("cumulates actual, avoidable, and the discrepancy-free line (actual + avoidable)", () => {
    const curve = buildDiscrepancyCurve([
      { sequence: 1, dateKey: "d", strategyExpectancyR: 0.5, actualR: -1, avoidableR: 1 }, // would-not-repeat
      { sequence: 2, dateKey: "d", strategyExpectancyR: 0.5, actualR: 2, avoidableR: 0 }, // would-repeat
    ]);
    expect(curve[1]).toMatchObject({
      actualEquity: 1,
      avoidableEquity: 1,
      discrepancyFreeEquity: 2, // 1 actual + 1 avoidable
      expectedStatisticalEquity: 1,
    });
  });
});
