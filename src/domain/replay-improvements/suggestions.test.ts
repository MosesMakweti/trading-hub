import { describe, expect, it } from "vitest";

import { deriveSuggestedCommitments } from "@/domain/replay-improvements/suggestions";
import { makeComparison } from "@/domain/replay-improvements/test-fixture";

describe("deriveSuggestedCommitments", () => {
  it("repeated stop widening suggests the stop-widening commitment", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: {
          count: 2,
          totalCostR: 0,
          events: [
            { dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "STOP_WIDENING", costR: null, description: "a" },
            { dateKey: "2026-08-05", assetSymbol: "XAUUSD", category: "STOP_WIDENING", costR: null, description: "b" },
          ],
        },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const suggestions = deriveSuggestedCommitments(comparison);
    expect(suggestions.some((s) => s.ruleKey === "STOP_WIDENING_PATTERN")).toBe(true);
    const s = suggestions.find((s) => s.ruleKey === "STOP_WIDENING_PATTERN")!;
    expect(s.category).toBe("EXECUTION");
    expect(s.priority).toBe("MEDIUM"); // 2 occurrences, no R cost
  });

  it("repeated premature closes with meaningful R-cost suggests the target-discipline commitment at HIGH priority", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: {
          count: 2,
          totalCostR: 1.2,
          events: [
            { dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "PREMATURE_CLOSE", costR: 0.6, description: "a" },
            { dateKey: "2026-08-05", assetSymbol: "XAUUSD", category: "PREMATURE_CLOSE", costR: 0.6, description: "b" },
          ],
        },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 1.2, formula: "x" },
      },
    });
    const s = deriveSuggestedCommitments(comparison).find((s) => s.ruleKey === "PREMATURE_CLOSE_PATTERN")!;
    expect(s).toBeDefined();
    expect(s.priority).toBe("HIGH"); // total cost >= 1R
    expect(s.evidence.some((e) => e.includes("1.20R"))).toBe(true);
  });

  it("repeated overrides suggest an override-discipline commitment", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: {
          count: 3,
          events: [
            { dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "OVERRIDE_VS_SKIP", description: "a" },
            { dateKey: "2026-08-05", assetSymbol: "XAUUSD", category: "OVERRIDE_VS_SKIP", description: "b" },
            { dateKey: "2026-08-06", assetSymbol: "XAUUSD", category: "OVERRIDE_VS_SKIP", description: "c" },
          ],
        },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const s = deriveSuggestedCommitments(comparison).find((s) => s.ruleKey === "OVERRIDE_DISCIPLINE")!;
    expect(s).toBeDefined();
    expect(s.category).toBe("BEHAVIOR");
    expect(s.priority).toBe("HIGH"); // 3 occurrences
  });

  it("one valid loss (no discrepancy events at all) produces no suggestions", () => {
    expect(deriveSuggestedCommitments(makeComparison())).toEqual([]);
  });

  it("a single execution discrepancy event produces no suggestion — minimum evidence is 2", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: {
          count: 1,
          totalCostR: 0.3,
          events: [{ dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "STOP_WIDENING", costR: null, description: "a" }],
        },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    expect(deriveSuggestedCommitments(comparison)).toEqual([]);
  });

  it("an unconfirmed missed opportunity never contributes — opportunityDiscrepancy only ever counts confirmed ones", () => {
    // opportunityDiscrepancy.count reflects only CONFIRMED entries by construction
    // (guaranteed upstream by discrepancy-buckets.ts) — a count of 1 here still
    // requires the >=2 threshold before suggesting.
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 1, totalReplayR: 2, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    expect(deriveSuggestedCommitments(comparison).some((s) => s.ruleKey === "MISSED_OPPORTUNITY_DISCIPLINE")).toBe(false);
  });

  it("deduplicates — many stop-widening events still produce exactly one suggestion", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      dateKey: `2026-08-0${i + 1}`,
      assetSymbol: "XAUUSD",
      category: "STOP_WIDENING" as const,
      costR: null,
      description: "x",
    }));
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 5, totalCostR: 0, events },
        behavioralDiscrepancy: { count: 0, events: [] },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const matches = deriveSuggestedCommitments(comparison).filter((s) => s.ruleKey === "STOP_WIDENING_PATTERN");
    expect(matches).toHaveLength(1);
  });

  it("a single frozen negative behaviour-label event still suggests, at LOW priority", () => {
    const comparison = makeComparison({
      discrepancy: {
        strategyVariance: { count: 0, entries: [] },
        executionDiscrepancy: { count: 0, totalCostR: 0, events: [] },
        behavioralDiscrepancy: {
          count: 1,
          events: [{ dateKey: "2026-08-04", assetSymbol: "XAUUSD", category: "BEHAVIOUR_LABEL_EVIDENCE", description: 'Actual trade carries the "FOMO" behaviour label.' }],
        },
        opportunityDiscrepancy: { count: 0, totalReplayR: 0, entries: [] },
        avoidableDiscrepancy: { totalR: 0, formula: "x" },
      },
    });
    const s = deriveSuggestedCommitments(comparison).find((s) => s.ruleKey === "BEHAVIOUR_LABEL_PATTERN")!;
    expect(s).toBeDefined();
    expect(s.priority).toBe("LOW");
  });
});
