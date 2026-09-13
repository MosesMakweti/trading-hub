import { describe, expect, it } from "vitest";

import {
  deriveBehavioralFindings,
  deriveExecutionFindings,
  deriveOpportunityFindings,
  derivePositiveFindings,
  deriveStrategyVarianceFindings,
} from "@/domain/replay-improvements/findings";
import { makeComparison } from "@/domain/replay-improvements/test-fixture";

describe("deriveExecutionFindings", () => {
  it("derives a finding grouped by category with a defensible R-cost", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: {
          count: 2,
          totalCostR: 0.5,
          events: [
            { dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "ENTRY_DEGRADATION", costR: 0.3, description: "a" },
            { dateKey: "2026-08-05", assetSymbol: "XAUUSD", category: "ENTRY_DEGRADATION", costR: 0.2, description: "b" },
          ],
        },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0.5, formula: "x" },
      },
    });
    const findings = deriveExecutionFindings(comparison);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe("EXECUTION_ENTRY_DEGRADATION");
    expect(findings[0].count).toBe(2);
    expect(findings[0].rImpact).toBeCloseTo(0.5, 4);
    expect(findings[0].severity).toBe("MEDIUM"); // count 2, cost < 1
  });

  it("a single event is INFORMATIONAL severity, not elevated", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: {
          count: 1,
          totalCostR: 0.1,
          events: [{ dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "STOP_WIDENING", costR: null, description: "a" }],
        },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    expect(deriveExecutionFindings(comparison)[0].severity).toBe("INFORMATIONAL");
  });
});

describe("deriveBehavioralFindings", () => {
  it("derives a finding grouped by category", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: {
          count: 2,
          events: [
            { dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "OVERRIDE_VS_SKIP", description: "a" },
            { dateKey: "2026-08-05", assetSymbol: "XAUUSD", category: "OVERRIDE_VS_SKIP", description: "b" },
          ],
        },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const findings = deriveBehavioralFindings(comparison);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe("BEHAVIOR_OVERRIDE_VS_SKIP");
    expect(findings[0].rImpact).toBeNull(); // behaviour is never converted to R
  });
});

describe("deriveOpportunityFindings", () => {
  it("only ever reflects CONFIRMED missed opportunities (guaranteed upstream)", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: {
          count: 1,
          totalReplayR: 2,
          entries: [{ replayTradeId: "rt-1", dateKey: "2026-08-04", assetSymbol: "EURUSD", strategyName: null, setupTypeName: null, replayValidationState: "VALIDATED", replayRealizedR: 2, confirmedAt: "2026-08-04T00:00:00.000Z" }],
        },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const findings = deriveOpportunityFindings(comparison);
    expect(findings).toHaveLength(1);
    expect(findings[0].rImpact).toBeNull(); // never automatically "avoidable"
    expect(findings[0].statement).toMatch(/not automatically/i);
  });

  it("produces no finding when there are zero confirmed missed opportunities", () => {
    expect(deriveOpportunityFindings(makeComparison())).toEqual([]);
  });
});

describe("deriveStrategyVarianceFindings", () => {
  it("is always INFORMATIONAL — never ranked as a behavioral failure", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 3, entries: [{ dateKey: "2026-08-04", assetSymbol: "XAUUSD", actualR: -1, replayR: -1, note: "x" }] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const findings = deriveStrategyVarianceFindings(comparison);
    expect(findings[0].severity).toBe("INFORMATIONAL");
    expect(findings[0].statement).toMatch(/no change required/i);
  });

  it("a raw outcome gap alone (no strategy variance count) produces no finding", () => {
    expect(deriveStrategyVarianceFindings(makeComparison())).toEqual([]);
  });
});

describe("derivePositiveFindings", () => {
  it("surfaces 'no stop widening' only when comparable execution evidence exists", () => {
    const withData = makeComparison({
      matched: [{ execution: { comparable: true, actualHadPartials: false, replayHadPartials: false } } as never],
    });
    expect(derivePositiveFindings(withData).some((f) => f.key === "NO_STOP_WIDENING")).toBe(true);

    const withoutData = makeComparison({ matched: [] });
    expect(derivePositiveFindings(withoutData).some((f) => f.key === "NO_STOP_WIDENING")).toBe(false);
  });

  it("surfaces 'fewer Replay overrides' only when Actual actually overrode more", () => {
    const comparison = makeComparison({
      overrideAnalysis: {
        actual: { validated: 5, overridden: 3, notValidated: 0 },
        replay: { validated: 5, overridden: 1, skipped: 0 },
        actualOverrideReplaySkipped: 0,
        actualOverrideReplayValidated: 0,
        actualValidatedReplaySkipped: 0,
      },
    });
    expect(derivePositiveFindings(comparison).some((f) => f.key === "FEWER_REPLAY_OVERRIDES")).toBe(true);
  });
});
