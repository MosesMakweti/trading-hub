import { describe, expect, it } from "vitest";

import {
  buildOpportunityCurve,
  summarizeOpportunities,
  type OpportunityInput,
} from "./opportunity-engine";

// Builders for the two branches. Defaults describe a "clean" opportunity so each
// test overrides only the field under scrutiny.
const executed = (over: Partial<OpportunityInput> = {}): OpportunityInput => ({
  opportunityId: "op",
  sequence: 1,
  dateKey: "2026-01-01",
  outcome: "EXECUTED",
  valid: true,
  strategyExpectancyR: 0.5,
  executionScore: 100,
  actualR: 0.5,
  ...over,
});

const missed = (over: Partial<OpportunityInput> = {}): OpportunityInput => ({
  opportunityId: "op",
  sequence: 1,
  dateKey: "2026-01-01",
  outcome: "MISSED",
  valid: true,
  strategyExpectancyR: 0.5,
  missedRealizedR: 3,
  ...over,
});

describe("opportunity-engine — scenario A: executed valid trade under-captures (execution leakage)", () => {
  it("splits the gap into execution leakage, not missed cost", () => {
    // expectancy 0.5 × execScore 80% = 0.40 expected; realized 0.10 → 0.30 leakage.
    const s = summarizeOpportunities([executed({ executionScore: 80, actualR: 0.1 })]);
    expect(s.executionLeakageR).toBe(0.3);
    expect(s.missedOpportunityCostR).toBe(0);
    expect(s.totalDiscrepancyR).toBe(0.3);
    expect(s.realizedR).toBe(0.1);
    expect(s.potentialR).toBe(0.4);
    expect(s.edgeCapturePercent).toBe(25); // 0.10 / 0.40
    expect(s.executed).toBe(1);
    expect(s.missed).toBe(0);
    expect(s.executionRatePercent).toBe(100);
  });
});

describe("opportunity-engine — scenario B: missed valid winner (missed opportunity cost)", () => {
  it("charges the forgone R to missed cost, not execution leakage", () => {
    const s = summarizeOpportunities([missed({ missedRealizedR: 3 })]);
    expect(s.missedOpportunityCostR).toBe(3);
    expect(s.executionLeakageR).toBe(0);
    expect(s.totalDiscrepancyR).toBe(3);
    expect(s.realizedR).toBe(0);
    expect(s.potentialR).toBe(3);
    expect(s.edgeCapturePercent).toBe(0); // banked nothing of a 3R opportunity
    expect(s.missedWins).toBe(1);
    expect(s.executionRatePercent).toBe(0);
  });
});

describe("opportunity-engine — scenario C: missed valid loser is NOT penalized", () => {
  it("avoiding a losing setup costs nothing", () => {
    const s = summarizeOpportunities([missed({ missedRealizedR: -1 })]);
    expect(s.missedOpportunityCostR).toBe(0);
    expect(s.totalDiscrepancyR).toBe(0);
    expect(s.missedLosses).toBe(1);
    expect(s.missedWins).toBe(0);
    // realized 0 and potential 0 → edge capture is undefined, not 0/100.
    expect(s.edgeCapturePercent).toBeNull();
  });
});

describe("opportunity-engine — scenario D: missed UNDETERMINED is tracked but excluded from R cost", () => {
  it("counts the behavior without inventing an outcome", () => {
    const s = summarizeOpportunities([missed({ missedRealizedR: null })]);
    expect(s.missedOpportunityCostR).toBe(0);
    expect(s.missedUndetermined).toBe(1);
    expect(s.missedWins).toBe(0);
    expect(s.missedLosses).toBe(0);
    expect(s.missed).toBe(1);
  });
});

describe("opportunity-engine — scenario E: invalid setups are excluded from the gap", () => {
  it("an invalid setup never affects discrepancy, executed, or missed counts", () => {
    const s = summarizeOpportunities([
      executed({ valid: false, executionScore: 50, actualR: -1 }),
      missed({ valid: false, missedRealizedR: 5 }),
    ]);
    expect(s.invalidOpportunities).toBe(2);
    expect(s.validOpportunities).toBe(0);
    expect(s.executed).toBe(0);
    expect(s.missed).toBe(0);
    expect(s.executionLeakageR).toBe(0);
    expect(s.missedOpportunityCostR).toBe(0);
    expect(s.executionRatePercent).toBeNull();
  });
});

describe("opportunity-engine — scenario F: one opportunity → one outcome (no double counting)", () => {
  it("an executed opportunity is never also counted as a missed one, even with stale missed fields", () => {
    // outcome EXECUTED wins; the leftover missedRealizedR must be ignored entirely.
    const s = summarizeOpportunities([
      executed({ executionScore: 100, actualR: 0.5, missedRealizedR: 9 }),
    ]);
    expect(s.executed).toBe(1);
    expect(s.missed).toBe(0);
    expect(s.missedOpportunityCostR).toBe(0); // 9R phantom NOT counted
    expect(s.missedWins).toBe(0);
    expect(s.realizedR).toBe(0.5);
    expect(s.executionLeakageR).toBe(0); // full execution, no gap
  });
});

describe("opportunity-engine — scenario G: mixed portfolio decomposes and sums correctly", () => {
  const inputs: OpportunityInput[] = [
    executed({ opportunityId: "a", sequence: 1, executionScore: 80, actualR: 0.1 }), // 0.30 leakage
    missed({ opportunityId: "b", sequence: 2, missedRealizedR: 3 }), // 3.00 missed win
    missed({ opportunityId: "c", sequence: 3, missedRealizedR: -1 }), // missed loss (0)
    missed({ opportunityId: "d", sequence: 4, missedRealizedR: null }), // undetermined (0)
    executed({ opportunityId: "e", sequence: 5, valid: false, actualR: 2 }), // invalid (excluded)
  ];

  it("Total Discrepancy = Execution Leakage + Missed Opportunity Cost, with no overlap", () => {
    const s = summarizeOpportunities(inputs);
    expect(s.validOpportunities).toBe(4);
    expect(s.invalidOpportunities).toBe(1);
    expect(s.executed).toBe(1);
    expect(s.missed).toBe(3);
    expect(s.executionRatePercent).toBe(25); // 1 of 4 valid taken

    expect(s.executionLeakageR).toBe(0.3);
    expect(s.missedOpportunityCostR).toBe(3);
    // The decomposition must add up to the total exactly.
    expect(s.totalDiscrepancyR).toBe(3.3);
    expect(round2(s.executionLeakageR + s.missedOpportunityCostR)).toBe(s.totalDiscrepancyR);

    expect(s.realizedR).toBe(0.1);
    expect(s.potentialR).toBe(3.4);
    expect(s.missedWins).toBe(1);
    expect(s.missedLosses).toBe(1);
    expect(s.missedUndetermined).toBe(1);
  });

  it("the cumulative curve ends at the summary totals and excludes invalid setups", () => {
    const curve = buildOpportunityCurve(inputs);
    expect(curve).toHaveLength(4); // invalid 'e' dropped
    const last = curve[curve.length - 1];
    expect(last.realizedEquity).toBe(0.1);
    expect(last.leakageEquity).toBe(0.3);
    expect(last.missedCostEquity).toBe(3);
    expect(last.potentialEquity).toBe(3.4);
  });
});

const round2 = (n: number): number => Math.round(n * 100) / 100;
