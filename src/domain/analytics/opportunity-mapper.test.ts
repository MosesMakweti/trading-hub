import { describe, expect, it } from "vitest";

import { toOpportunityInputs, type OpportunityRow } from "./opportunity-mapper";
import { summarizeOpportunities } from "./opportunity-engine";

const row = (over: Partial<OpportunityRow>): OpportunityRow => ({
  id: "op",
  status: "MISSED",
  spottedAtKey: "2026-01-01",
  createdAtMs: 0,
  setupValid: true,
  expectedExpectancyR: 0.5,
  missedRealizedR: null,
  executedTrade: null,
  ...over,
});

describe("toOpportunityInputs", () => {
  it("keeps only resolved (EXECUTED/MISSED) opportunities", () => {
    const inputs = toOpportunityInputs([
      row({ id: "pending", status: "PENDING" }),
      row({ id: "invalidated", status: "INVALIDATED" }),
      row({ id: "expired", status: "EXPIRED" }),
      row({ id: "missed", status: "MISSED", missedRealizedR: 2 }),
      row({ id: "executed", status: "EXECUTED", executedTrade: { actualR: 1, tradeQualityPercent: 90, setupScore: null, confluencePercent: null } }),
    ]);
    expect(inputs.map((i) => i.opportunityId)).toEqual(["missed", "executed"]);
  });

  it("orders by spotted day then creation, with a stable 1-based sequence", () => {
    const inputs = toOpportunityInputs([
      row({ id: "c", spottedAtKey: "2026-01-02", createdAtMs: 5 }),
      row({ id: "a", spottedAtKey: "2026-01-01", createdAtMs: 10 }),
      row({ id: "b", spottedAtKey: "2026-01-01", createdAtMs: 20 }),
    ]);
    expect(inputs.map((i) => [i.opportunityId, i.sequence])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("derives an executed trade's composite execution score (quality → setup → confluence)", () => {
    const [input] = toOpportunityInputs([
      row({
        status: "EXECUTED",
        executedTrade: { actualR: 0.8, tradeQualityPercent: null, setupScore: 82, confluencePercent: 50 },
      }),
    ]);
    expect(input.outcome).toBe("EXECUTED");
    expect(input.executionScore).toBe(82); // setupScore wins (quality null)
    expect(input.actualR).toBe(0.8);
  });

  it("passes a missed setup's trader-entered realized R straight through", () => {
    const [input] = toOpportunityInputs([row({ status: "MISSED", missedRealizedR: 3 })]);
    expect(input.outcome).toBe("MISSED");
    expect(input.missedRealizedR).toBe(3);
  });

  it("feeds the engine end-to-end: an executed + a missed winner decompose correctly", () => {
    const inputs = toOpportunityInputs([
      row({ id: "e", status: "EXECUTED", expectedExpectancyR: 0.5, executedTrade: { actualR: 0.1, tradeQualityPercent: 80, setupScore: null, confluencePercent: null } }),
      row({ id: "m", status: "MISSED", missedRealizedR: 3 }),
    ]);
    const s = summarizeOpportunities(inputs);
    expect(s.executionLeakageR).toBe(0.3); // 0.5×80% − 0.1
    expect(s.missedOpportunityCostR).toBe(3);
    expect(s.totalDiscrepancyR).toBe(3.3);
  });
});
