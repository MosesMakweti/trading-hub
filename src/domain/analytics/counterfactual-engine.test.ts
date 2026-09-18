import { describe, it, expect } from "vitest";

import type { Deviation } from "./deviation-engine";
import {
  buildCounterfactualCurve,
  reconstructEvent,
  summarizeAttribution,
  type CounterfactualInput,
  type ExecutedEventInput,
  type MissedEventInput,
} from "./counterfactual-engine";

// ── Builders ───────────────────────────────────────────────────────────────
const dev = (cause: Deviation["cause"], costR: number): Deviation => ({
  cause,
  label: cause,
  costR,
});

const executed = (o: Partial<ExecutedEventInput> = {}): ExecutedEventInput => ({
  kind: "EXECUTED",
  eventId: o.eventId ?? "t1",
  sequence: o.sequence ?? 1,
  dateKey: o.dateKey ?? "2026-01-01",
  actualR: o.actualR ?? null,
  validSetup: o.validSetup ?? true,
  missingConfluences: o.missingConfluences ?? [],
  deviations: o.deviations ?? [],
  wouldTakeAgain: o.wouldTakeAgain ?? null,
  behaviorTag: o.behaviorTag ?? null,
  psychologyPercent: o.psychologyPercent ?? null,
  sessionViolation: o.sessionViolation,
  missingExecutionConfirmations: o.missingExecutionConfirmations,
  exceededDailyRisk: o.exceededDailyRisk,
  overtrade: o.overtrade,
});

const missed = (o: Partial<MissedEventInput> = {}): MissedEventInput => ({
  kind: "MISSED",
  eventId: o.eventId ?? "m1",
  sequence: o.sequence ?? 1,
  dateKey: o.dateKey ?? "2026-01-01",
  validSetup: o.validSetup ?? true,
  missedRealizedR: o.missedRealizedR ?? null,
});

describe("counterfactual-engine — spec examples", () => {
  it("valid setup + correct execution + −1R loss → ZERO discrepancy", () => {
    const e = reconstructEvent(executed({ actualR: -1, validSetup: true }));
    expect(e.avoidableR).toBe(0);
    expect(e.processPerfectR).toBe(-1);
    expect(e.processBreach).toBe(false);
    expect(e.leakages).toHaveLength(0);
  });

  it("valid setup + correct execution + winner → ZERO discrepancy (never penalised)", () => {
    const e = reconstructEvent(executed({ actualR: 2.4, validSetup: true }));
    expect(e.avoidableR).toBe(0);
    expect(e.unearnedR).toBe(0);
    expect(e.processPerfectR).toBe(2.4);
  });

  it("planned −1R stop but actual −1.4R → 0.4R execution leakage", () => {
    const e = reconstructEvent(executed({ actualR: -1.4, deviations: [dev("loss-overrun", 0.4)] }));
    expect(e.avoidableR).toBe(0.4);
    expect(e.processPerfectR).toBe(-1); // −1.4 + 0.4 recovered
    expect(e.leakages[0]).toMatchObject({ category: "EXECUTION", confidence: "MEASURED", rImpact: 0.4 });
  });

  it("target should have made +2R but early exit at +0.7R → 1.3R leakage", () => {
    const e = reconstructEvent(executed({ actualR: 0.7, deviations: [dev("premature-exit", 1.3)] }));
    expect(e.avoidableR).toBe(1.3);
    expect(e.processPerfectR).toBe(2); // 0.7 + 1.3
    expect(e.leakages[0]).toMatchObject({ category: "EXECUTION", rImpact: 1.3 });
  });

  it("FOMO trade outside strategy loses −1R → ~1R behavioral leakage", () => {
    const e = reconstructEvent(executed({ actualR: -1, behaviorTag: "FOMO" }));
    expect(e.avoidableR).toBe(1);
    expect(e.processPerfectR).toBe(0); // process would not take it
    expect(e.leakages[0]).toMatchObject({ category: "BEHAVIORAL", cause: "fomo", rImpact: 1 });
  });

  it("invalid trade WINS +2R → flag as breach, do NOT reward, do NOT shade", () => {
    const e = reconstructEvent(executed({ actualR: 2, validSetup: false }));
    expect(e.avoidableR).toBe(0); // not shaded
    expect(e.unearnedR).toBe(2); // tracked separately
    expect(e.processPerfectR).toBe(0);
    expect(e.processBreach).toBe(true);
    expect(e.leakages[0]).toMatchObject({ confidence: "FLAGGED", attributionKnown: false, rImpact: null });
  });

  it("invalid trade LOSES −1R → recovered as strategy-adherence leakage", () => {
    const e = reconstructEvent(executed({ actualR: -1, missingConfluences: ["London open"] }));
    expect(e.avoidableR).toBe(1);
    expect(e.processPerfectR).toBe(0);
    expect(e.leakages[0]).toMatchObject({ category: "STRATEGY_ADHERENCE", cause: "missing-confluence", rImpact: 1 });
  });

  it("missed valid winner (+3R) → 3R opportunity leakage", () => {
    const e = reconstructEvent(missed({ missedRealizedR: 3 }));
    expect(e.avoidableR).toBe(3);
    expect(e.processPerfectR).toBe(3);
    expect(e.actualR).toBe(0);
    expect(e.leakages[0]).toMatchObject({ category: "OPPORTUNITY", rImpact: 3 });
  });

  it("missed valid LOSER → correctly avoided, cost 0", () => {
    const e = reconstructEvent(missed({ missedRealizedR: -1 }));
    expect(e.avoidableR).toBe(0);
    expect(e.processPerfectR).toBe(0);
    expect(e.leakages).toHaveLength(0);
  });

  it("missed UNDETERMINED → no fabricated R", () => {
    const e = reconstructEvent(missed({ missedRealizedR: null }));
    expect(e.avoidableR).toBe(0);
    expect(e.leakages).toHaveLength(0);
  });
});

// Stage C.1 — a null actualR means "not settled yet" (pending), not "0R
// breakeven." Before this fix, `actualR ?? 0` let a valid trade's real,
// independently-measured deviations (computed from planned/actual PRICES,
// not from actualR) still accumulate into processPerfectR on top of the
// coalesced 0, fabricating a positive avoidableR for a trade with no
// determined outcome at all.
describe("counterfactual-engine — pending trades never fabricate a discrepancy", () => {
  it("null actualR with a real measurable deviation still produces a true no-op", () => {
    const e = reconstructEvent(executed({ actualR: null, deviations: [dev("late-entry", 0.5)] }));
    expect(e.actualR).toBe(0);
    expect(e.processPerfectR).toBe(0);
    expect(e.avoidableR).toBe(0);
    expect(e.unearnedR).toBe(0);
    expect(e.processBreach).toBe(false);
    expect(e.leakages).toHaveLength(0);
  });

  it("null actualR on an invalid/skip-tagged setup also produces a true no-op, not a fabricated avoidable loss", () => {
    const e = reconstructEvent(executed({ actualR: null, validSetup: false }));
    expect(e.avoidableR).toBe(0);
    expect(e.unearnedR).toBe(0);
    expect(e.leakages).toHaveLength(0);
    expect(e.validSetup).toBe(false); // setup validity is still known independent of settlement
  });

  it("a settled 0R breakeven (not null) is unaffected by the pending short-circuit", () => {
    const e = reconstructEvent(executed({ actualR: 0, deviations: [dev("late-entry", 0.5)] }));
    expect(e.actualR).toBe(0);
    expect(e.processPerfectR).toBe(0.5); // deviation cost still applies once the outcome is genuinely known
    expect(e.avoidableR).toBe(0.5);
  });
});

describe("counterfactual-engine — flagged (unknown-R) breaches", () => {
  it("valid trade, would-not-repeat → flagged behavioral, no shaded R", () => {
    const e = reconstructEvent(executed({ actualR: -1, wouldTakeAgain: false }));
    expect(e.avoidableR).toBe(0); // R unknown → never fabricated
    expect(e.processBreach).toBe(true);
    expect(e.leakages[0]).toMatchObject({ category: "BEHAVIORAL", cause: "would-not-repeat", rImpact: null });
  });

  it("session + daily-risk + overtrade flags surface without inventing R", () => {
    const e = reconstructEvent(
      executed({ actualR: 1, sessionViolation: true, exceededDailyRisk: true, overtrade: true }),
    );
    expect(e.avoidableR).toBe(0);
    const causes = e.leakages.map((l) => l.cause).sort();
    expect(causes).toEqual(["daily-risk-limit", "overtrading", "session-violation"]);
    expect(e.leakages.every((l) => l.rImpact === null)).toBe(true);
  });

  it("measured deviation coexists with flagged behavioral on the same trade", () => {
    const e = reconstructEvent(
      executed({ actualR: 0.7, deviations: [dev("premature-exit", 1.3)], wouldTakeAgain: false }),
    );
    expect(e.avoidableR).toBe(1.3); // only the measured part is recoverable
    const measured = e.leakages.filter((l) => l.rImpact != null);
    expect(measured).toHaveLength(1);
  });
});

describe("counterfactual-engine — invariant: avoidableR == Σ measured rImpact", () => {
  const cases: CounterfactualInput[] = [
    executed({ actualR: -1.4, deviations: [dev("loss-overrun", 0.4), dev("increased-risk", 0.2)] }),
    executed({ actualR: -1, behaviorTag: "REVENGE" }),
    executed({ actualR: -2, validSetup: false }),
    missed({ missedRealizedR: 3 }),
    executed({ actualR: 1.2 }),
  ];
  it.each(cases)("holds for %#", (input) => {
    const e = reconstructEvent(input);
    const measuredSum =
      Math.round(e.leakages.reduce((s, l) => s + (l.rImpact ?? 0), 0) * 100) / 100;
    expect(e.avoidableR).toBe(measuredSum);
  });
});

describe("counterfactual-engine — curve", () => {
  it("avoidableGap is monotonic and cumulative equities are correct", () => {
    const inputs: CounterfactualInput[] = [
      executed({ eventId: "a", sequence: 1, actualR: -1 }), // clean loss → 0 gap
      executed({ eventId: "b", sequence: 2, actualR: 0.7, deviations: [dev("premature-exit", 1.3)] }), // +1.3
      missed({ eventId: "c", sequence: 3, missedRealizedR: 3 }), // +3
      executed({ eventId: "d", sequence: 4, actualR: 2, validSetup: false }), // lucky breach: gap +0
    ];
    const curve = buildCounterfactualCurve(inputs);
    expect(curve.map((p) => p.avoidableGap)).toEqual([0, 1.3, 4.3, 4.3]);
    expect(curve.map((p) => p.actualEquity)).toEqual([-1, -0.3, -0.3, 1.7]);
    expect(curve.map((p) => p.processPerfectEquity)).toEqual([-1, 1, 4, 4]);
    // Monotonic non-decreasing avoidableGap
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].avoidableGap).toBeGreaterThanOrEqual(curve[i - 1].avoidableGap);
    }
    expect(curve[3].stepUnearnedR).toBe(2);
  });
});

describe("counterfactual-engine — attribution summary", () => {
  const inputs: CounterfactualInput[] = [
    executed({ eventId: "a", sequence: 1, actualR: -1 }), // clean
    executed({ eventId: "b", sequence: 2, actualR: 0.7, deviations: [dev("premature-exit", 1.3)] }), // EXECUTION 1.3
    executed({ eventId: "c", sequence: 3, actualR: -1, behaviorTag: "FOMO" }), // BEHAVIORAL 1
    missed({ eventId: "d", sequence: 4, missedRealizedR: 3 }), // OPPORTUNITY 3
    executed({ eventId: "e", sequence: 5, actualR: 1, wouldTakeAgain: false }), // flagged only
  ];

  it("totals and category shares are correct", () => {
    const s = summarizeAttribution(inputs);
    expect(s.totalAvoidableGapR).toBe(5.3); // 1.3 + 1 + 3
    expect(s.realizedR).toBe(-0.3); // -1 + 0.7 - 1 + 0 + 1
    const exec = s.byCategory.find((c) => c.category === "EXECUTION");
    const beh = s.byCategory.find((c) => c.category === "BEHAVIORAL");
    const opp = s.byCategory.find((c) => c.category === "OPPORTUNITY");
    expect(exec?.measuredR).toBe(1.3);
    expect(beh?.measuredR).toBe(1);
    expect(opp?.measuredR).toBe(3);
  });

  it("process efficiency and data confidence reflect breaches", () => {
    const s = summarizeAttribution(inputs);
    // realized -0.3 / potential (−0.3 + 5.3 = 5.0) × 100
    expect(s.processEfficiencyPercent).toBe(-6);
    // 4 of 5 events carry a breach (only the clean loss doesn't); event "e" is flagged
    expect(s.processBreaches).toBe(4);
    // confident events = those with no flagged leakage = a, b, c, d (e is flagged) = 4/5
    expect(s.dataConfidencePercent).toBe(80);
  });

  it("clean-only history has zero gap and 100% confidence", () => {
    const s = summarizeAttribution([
      executed({ eventId: "x", sequence: 1, actualR: 1.5 }),
      executed({ eventId: "y", sequence: 2, actualR: -1 }),
    ]);
    expect(s.totalAvoidableGapR).toBe(0);
    expect(s.processEfficiencyPercent).toBe(100);
    expect(s.dataConfidencePercent).toBe(100);
    expect(s.byCategory).toHaveLength(0);
  });
});
