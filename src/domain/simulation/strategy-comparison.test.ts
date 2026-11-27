import { describe, expect, it } from "vitest";

import { comparisonWarnings, conditionDifferences, groupResults, type SessionConditions, type TradeRow } from "@/domain/simulation/strategy-comparison";

const cond = (over: Partial<SessionConditions> = {}): SessionConditions => ({
  accountId: Math.random().toString(),
  name: "s",
  pins: { EURUSD: "dataset-1" },
  periodStart: "2024-01-01",
  periodEnd: "2024-03-31",
  startingBalance: "10000",
  currency: "USD",
  rules: { costs: { commissionPerUnitPerSide: 3.5 } },
  ...over,
});

const row = (r: number, over: Partial<TradeRow> = {}): TradeRow => ({
  executed: true, r, outcome: "UNRESOLVED", minute: Math.floor(Math.random() * 1e6), accountId: "a", symbol: "EURUSD",
  session: "London", setupType: "Type A", executionScore: 80, followedRules: true, ...over,
});

describe("conditionDifferences", () => {
  it("is empty for identical conditions, regardless of rules key order", () => {
    const b = cond({ rules: { b: 1, a: 2 } });
    const e = cond({ rules: { a: 2, b: 1 } });
    expect(conditionDifferences([b], [e])).toEqual([]);
  });

  it("names every condition that differs", () => {
    const diffs = conditionDifferences([cond()], [cond({ periodEnd: "2024-06-30", pins: { EURUSD: "dataset-2" }, startingBalance: "5000" })]);
    expect(diffs.map((d) => d.field)).toEqual(["Instruments & datasets", "Period", "Starting balance"]);
  });
});

describe("groupResults + comparisonWarnings", () => {
  it("computes adherence, execution score and breakdowns", () => {
    const g = groupResults([row(2), row(-1, { followedRules: false, executionScore: 40, session: null }), row(1, { followedRules: null, executionScore: null })], 1);
    expect(g.averageExecutionScore).toBe(60);
    expect(g.ruleAdherence).toBe(50);
    expect(g.evaluatedTrades).toBe(2);
    expect(g.bySession.map((s) => s.label).sort()).toEqual(["London", "Outside sessions / not evaluated"]);
    expect(g.byRuleAdherence.map((s) => s.label).sort()).toEqual(["Broke a rule", "Followed the rules"]);
  });

  it("warns about differing conditions, small samples and many variations — and always about profit-only judgement", () => {
    const small = groupResults([row(1), row(-1)], 1);
    const w = comparisonWarnings({ baseline: small, experiment: small, differences: conditionDifferences([cond()], [cond({ periodStart: "2023-01-01" })]), variationsTested: 4 });
    expect(w.map((x) => x.kind)).toEqual(["CONDITIONS_DIFFER", "SMALL_SAMPLE", "SMALL_SAMPLE", "MANY_VARIATIONS", "PROFIT_ONLY"]);
    const none = comparisonWarnings({ baseline: groupResults([], 0), experiment: small, differences: [], variationsTested: 1 });
    expect(none[0].kind).toBe("NO_RESULTS");
  });
});
