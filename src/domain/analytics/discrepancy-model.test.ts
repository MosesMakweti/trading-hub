import { describe, expect, it } from "vitest";

import {
  buildDiscrepancyCurve,
  classifyTrade,
  summarizeDiscrepancy,
  type DiscrepancyTradeInput,
  type TradeProcessInput,
} from "./discrepancy-model";
import type { Deviation } from "./deviation-engine";

const dev = (costR: number): Deviation => ({ cause: "late-entry", label: "Late / chased entry", costR });

const proc = (over: Partial<TradeProcessInput>): TradeProcessInput => ({
  actualR: 1,
  deviations: [],
  adherenceFollowed: true,
  hasExecutionData: true,
  ...over,
});

describe("classifyTrade — loss ≠ discrepancy (the core invariant)", () => {
  it("perfect execution + WIN → NORMAL_WIN, avoidable 0", () => {
    const r = classifyTrade(proc({ actualR: 2 }));
    expect(r.classification).toBe("NORMAL_WIN");
    expect(r.avoidableR).toBe(0);
    expect(r.processDiscrepancy).toBe(false);
  });

  it("perfect execution + LOSS → NORMAL_LOSS, avoidable 0 (never penalise a correct loss)", () => {
    const r = classifyTrade(proc({ actualR: -1 }));
    expect(r.classification).toBe("NORMAL_LOSS");
    expect(r.avoidableR).toBe(0);
    expect(r.processDiscrepancy).toBe(false);
  });

  it("perfect execution + BREAKEVEN → NORMAL_BREAKEVEN, avoidable 0", () => {
    expect(classifyTrade(proc({ actualR: 0 })).classification).toBe("NORMAL_BREAKEVEN");
    expect(classifyTrade(proc({ actualR: 0 })).avoidableR).toBe(0);
  });
});

describe("classifyTrade — win ≠ good execution", () => {
  it("rule-broken + WIN → PROCESS_DISCREPANCY_WIN (rewarding a broken process is wrong)", () => {
    const r = classifyTrade(proc({ actualR: 2, adherenceFollowed: false }));
    expect(r.classification).toBe("PROCESS_DISCREPANCY_WIN");
    expect(r.processDiscrepancy).toBe(true);
  });

  it("rule-broken + LOSS → PROCESS_DISCREPANCY_LOSS", () => {
    expect(classifyTrade(proc({ actualR: -1, adherenceFollowed: false })).classification).toBe(
      "PROCESS_DISCREPANCY_LOSS",
    );
  });

  it("objective price deviation → avoidable = the deviation cost", () => {
    const r = classifyTrade(proc({ actualR: -1, deviations: [dev(0.4), dev(0.2)] }));
    expect(r.classification).toBe("PROCESS_DISCREPANCY_LOSS");
    expect(r.avoidableR).toBe(0.6);
  });

  it("rule-only violation (no price evidence) → process discrepancy but avoidable R stays 0 (UNDETERMINED)", () => {
    const r = classifyTrade(proc({ actualR: -1, adherenceFollowed: false, deviations: [] }));
    expect(r.processDiscrepancy).toBe(true);
    expect(r.avoidableR).toBe(0); // no fabricated counterfactual R
  });
});

describe("classifyTrade — insufficient info", () => {
  it("no execution data and no adherence signal → UNVERIFIED", () => {
    const r = classifyTrade({ actualR: -1, deviations: [], adherenceFollowed: null, hasExecutionData: false });
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
  it("cumulates expected-statistical vs actual and their variance", () => {
    const curve = buildDiscrepancyCurve([
      { sequence: 1, dateKey: "d", strategyExpectancyR: 0.5, actualR: -1, avoidableR: 0 },
      { sequence: 2, dateKey: "d", strategyExpectancyR: 0.5, actualR: 2, avoidableR: 0 },
    ]);
    expect(curve[1]).toMatchObject({ expectedStatisticalEquity: 1, actualEquity: 1, performanceVariance: 0 });
  });
});
