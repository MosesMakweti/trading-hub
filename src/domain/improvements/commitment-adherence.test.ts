import { describe, expect, it } from "vitest";

import {
  RESOLUTION_MIN_ADHERENCE,
  RESOLUTION_MIN_LIFETIME_OBSERVATIONS,
  TREND_MIN_OBSERVATIONS_PER_PERIOD,
  classifyTrend,
  computeAdherence,
  computePeriodAdherence,
  computeResolutionEligibility,
  deriveBehaviourLabelObservations,
  deriveMissedOpportunityObservations,
  deriveOverrideDisciplineObservations,
  deriveOvertradingObservations,
  derivePrematureCloseObservations,
  deriveRiskLimitObservations,
  deriveStopWideningObservations,
  describeRetirement,
  effectiveLineageId,
  filterStatesInPeriod,
  formatAdherencePercent,
  hasAutomaticEvidenceRule,
  type DailyStateForAdherence,
} from "@/domain/improvements/commitment-adherence";

function states(spec: [string, "ACKNOWLEDGED" | "FOLLOWED" | "BREACHED"][]): DailyStateForAdherence[] {
  return spec.map(([dateKey, status]) => ({ dateKey, status }));
}

describe("computeAdherence — §9/§10", () => {
  it("computes followed / (followed + breached)", () => {
    const result = computeAdherence(
      states([
        ["2026-08-01", "FOLLOWED"],
        ["2026-08-02", "FOLLOWED"],
        ["2026-08-03", "FOLLOWED"],
        ["2026-08-04", "FOLLOWED"],
        ["2026-08-05", "BREACHED"],
      ]),
    );
    expect(result.followed).toBe(4);
    expect(result.breached).toBe(1);
    expect(result.applicableObservations).toBe(5);
    expect(result.adherence).toBeCloseTo(0.8, 5);
  });

  it("excludes ACKNOWLEDGED entirely from the denominator and numerator", () => {
    const result = computeAdherence(
      states([
        ["2026-08-01", "ACKNOWLEDGED"],
        ["2026-08-02", "ACKNOWLEDGED"],
        ["2026-08-03", "FOLLOWED"],
      ]),
    );
    expect(result.acknowledgedCount).toBe(2);
    expect(result.applicableObservations).toBe(1);
    expect(result.adherence).toBe(1);
  });

  it("returns null adherence (never 0) when there are zero applicable observations", () => {
    const noStates = computeAdherence([]);
    expect(noStates.adherence).toBeNull();
    expect(noStates.applicableObservations).toBe(0);

    const onlyAcknowledged = computeAdherence(states([["2026-08-01", "ACKNOWLEDGED"]]));
    expect(onlyAcknowledged.adherence).toBeNull();
  });

  it("reports observation counts transparently — 1 observation is distinguishable from 25", () => {
    const one = computeAdherence(states([["2026-08-01", "FOLLOWED"]]));
    const many = computeAdherence(Array.from({ length: 25 }, (_, i) => ({ dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`, status: "FOLLOWED" as const })));
    expect(one.adherence).toBe(1);
    expect(many.adherence).toBe(1);
    expect(one.applicableObservations).toBe(1);
    expect(many.applicableObservations).toBe(25);
  });
});

describe("filterStatesInPeriod / computePeriodAdherence — §12", () => {
  it("filters by inclusive dateKey bounds", () => {
    const result = filterStatesInPeriod(
      states([
        ["2026-07-31", "FOLLOWED"],
        ["2026-08-01", "FOLLOWED"],
        ["2026-08-15", "BREACHED"],
        ["2026-09-01", "FOLLOWED"],
      ]),
      "2026-08-01",
      "2026-08-31",
    );
    expect(result.map((s) => s.dateKey)).toEqual(["2026-08-01", "2026-08-15"]);
  });

  const all = states([
    ["2026-07-01", "FOLLOWED"],
    ["2026-07-02", "BREACHED"],
    ["2026-08-01", "FOLLOWED"],
    ["2026-08-02", "FOLLOWED"],
    ["2026-08-03", "FOLLOWED"],
    ["2026-08-04", "BREACHED"],
  ]);

  it("buckets current/previous/lifetime independently from the same list", () => {
    const breakdown = computePeriodAdherence(all, { start: "2026-08-01", end: "2026-08-31" }, { start: "2026-07-01", end: "2026-07-31" });
    expect(breakdown.current.applicableObservations).toBe(4);
    expect(breakdown.current.adherence).toBeCloseTo(0.75, 5);
    expect(breakdown.previous!.applicableObservations).toBe(2);
    expect(breakdown.previous!.adherence).toBe(0.5);
    expect(breakdown.lifetime.applicableObservations).toBe(6);
  });

  it("returns null previous when no previous period is supplied (no lineage predecessor)", () => {
    const breakdown = computePeriodAdherence(all, { start: "2026-08-01", end: "2026-08-31" }, null);
    expect(breakdown.previous).toBeNull();
  });

  it("only compares periods with applicable observations — an empty period yields null adherence, not 0%", () => {
    const breakdown = computePeriodAdherence(all, { start: "2026-09-01", end: "2026-09-30" }, null);
    expect(breakdown.current.adherence).toBeNull();
    expect(breakdown.current.applicableObservations).toBe(0);
  });
});

describe("classifyTrend — §13", () => {
  function result(followed: number, breached: number) {
    return computeAdherence([
      ...Array.from({ length: followed }, (_, i) => ({ dateKey: `f${i}`, status: "FOLLOWED" as const })),
      ...Array.from({ length: breached }, (_, i) => ({ dateKey: `b${i}`, status: "BREACHED" as const })),
    ]);
  }

  it("is INSUFFICIENT_DATA with no previous period at all", () => {
    expect(classifyTrend(result(5, 0), null)).toBe("INSUFFICIENT_DATA");
  });

  it("is INSUFFICIENT_DATA when either period has no applicable observations", () => {
    expect(classifyTrend(result(5, 0), result(0, 0))).toBe("INSUFFICIENT_DATA");
  });

  it("never classifies from a single isolated observation, even if adherence swings from 50% to 100%", () => {
    // 1 followed vs previously 1 followed + 1 breached — both periods below the minimum sample threshold.
    expect(result(1, 0).applicableObservations).toBeLessThan(TREND_MIN_OBSERVATIONS_PER_PERIOD);
    expect(classifyTrend(result(1, 0), result(1, 1))).toBe("INSUFFICIENT_DATA");
  });

  it("classifies IMPROVING when adherence rises by at least the threshold with enough samples in both periods", () => {
    // previous: 2/4 = 50%, current: 4/4 = 100% -> +50pp
    expect(classifyTrend(result(4, 0), result(2, 2))).toBe("IMPROVING");
  });

  it("classifies DECLINING when adherence falls by at least the threshold", () => {
    // previous: 4/4 = 100%, current: 1/4 = 25% -> -75pp
    expect(classifyTrend(result(1, 3), result(4, 0))).toBe("DECLINING");
  });

  it("classifies STABLE for a small change within the threshold band", () => {
    // previous: 3/4 = 75%, current: 4/5 = 80% -> +5pp, below the 15pp bar
    expect(classifyTrend(result(4, 1), result(3, 1))).toBe("STABLE");
  });
});

describe("computeResolutionEligibility — §24/§25 (a suggestion only, trader still chooses)", () => {
  function sample(periodStart: string, followed: number, breached: number) {
    return { periodStart, result: computeAdherence([...Array(followed).fill("FOLLOWED"), ...Array(breached).fill("BREACHED")].map((status, i) => ({ dateKey: `${periodStart}-${i}`, status: status as "FOLLOWED" | "BREACHED" }))) };
  }

  it("is false when lifetime adherence is below the bar", () => {
    const lifetime = computeAdherence(Array.from({ length: 10 }, (_, i) => ({ dateKey: `d${i}`, status: i < 8 ? "FOLLOWED" : "BREACHED" as const })));
    expect(lifetime.adherence).toBeCloseTo(0.8, 5);
    expect(lifetime.adherence!).toBeLessThan(RESOLUTION_MIN_ADHERENCE);
    expect(computeResolutionEligibility(lifetime, [sample("p1", 8, 0), sample("p2", 8, 0)], [])).toBe(false);
  });

  it("is false when lifetime sample size is below the minimum, even at 100% adherence", () => {
    const lifetime = computeAdherence([{ dateKey: "d1", status: "FOLLOWED" }]);
    expect(lifetime.applicableObservations).toBeLessThan(RESOLUTION_MIN_LIFETIME_OBSERVATIONS);
    expect(computeResolutionEligibility(lifetime, [sample("p1", 5, 0), sample("p2", 5, 0)], [])).toBe(false);
  });

  it("is false when fewer than the minimum number of periods sustain the bar", () => {
    const lifetime = computeAdherence(Array.from({ length: 10 }, (_, i) => ({ dateKey: `d${i}`, status: "FOLLOWED" as const })));
    // Only ONE period actually clears the adherence bar; the other has zero applicable observations.
    expect(computeResolutionEligibility(lifetime, [sample("p1", 10, 0), { periodStart: "p2", result: computeAdherence([]) }], [])).toBe(false);
  });

  it("is false when a breach appears among the most recent applicable observations, even with a high lifetime average", () => {
    const chronological: DailyStateForAdherence[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ dateKey: `2026-01-${String(i + 1).padStart(2, "0")}`, status: "FOLLOWED" as const })),
      { dateKey: "2026-08-01", status: "BREACHED" }, // a recent breach
    ];
    const lifetime = computeAdherence(chronological);
    expect(computeResolutionEligibility(lifetime, [sample("p1", 10, 0), sample("p2", 10, 1)], chronological)).toBe(false);
  });

  it("is true when every criterion is deterministically satisfied", () => {
    const chronological: DailyStateForAdherence[] = Array.from({ length: 20 }, (_, i) => ({ dateKey: `2026-01-${String(i + 1).padStart(2, "0")}`, status: "FOLLOWED" as const }));
    const lifetime = computeAdherence(chronological);
    expect(computeResolutionEligibility(lifetime, [sample("p1", 10, 0), sample("p2", 10, 0)], chronological)).toBe(true);
  });

  it("resolution is always a suggestion, never a status mutation — this function returns a boolean, nothing else", () => {
    // Purely a type-level/behavioral confirmation: the function has no side effects and no persistence call.
    const lifetime = computeAdherence([{ dateKey: "d1", status: "FOLLOWED" }]);
    const result = computeResolutionEligibility(lifetime, [], []);
    expect(typeof result).toBe("boolean");
  });
});

describe("formatAdherencePercent — §14 no false precision", () => {
  it("rounds to a whole percent, never decimals", () => {
    expect(formatAdherencePercent(0.8)).toBe("80%");
    expect(formatAdherencePercent(0.66666)).toBe("67%");
    expect(formatAdherencePercent(1)).toBe("100%");
  });

  it("passes through null (no data) rather than formatting a fake value", () => {
    expect(formatAdherencePercent(null)).toBeNull();
  });
});

describe("system-observed evidence derivation — §15/§16/§34/§42", () => {
  it("override-discipline: OVERRIDDEN trades breach, VALIDATED trades follow, derived purely from Trade.validationState (no Replay)", () => {
    const result = deriveOverrideDisciplineObservations([
      { id: "t1", dateKey: "2026-08-01", validationState: "VALIDATED" },
      { id: "t2", dateKey: "2026-08-02", validationState: "OVERRIDDEN" },
      { id: "t3", dateKey: "2026-08-03", validationState: "NOT_VALIDATED" }, // no signal — not taken as evidence either way
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.dateKey === "2026-08-01")?.status).toBe("FOLLOWED");
    expect(result.find((r) => r.dateKey === "2026-08-02")?.status).toBe("BREACHED");
    expect(result.find((r) => r.dateKey === "2026-08-02")?.relatedTradeId).toBe("t2");
    expect(result.find((r) => r.dateKey === "2026-08-03")).toBeUndefined();
  });

  it("never uses PnL/realized R to decide override-discipline — only validationState", () => {
    const observations = deriveOverrideDisciplineObservations([{ id: "t1", dateKey: "2026-08-01", validationState: "VALIDATED" }]);
    // The input type itself carries no PnL/R field — this test documents that constraint structurally.
    expect(observations[0].status).toBe("FOLLOWED");
  });

  it("aggregates multiple same-day events conservatively — any breach that day makes the whole day BREACHED", () => {
    const result = deriveOverrideDisciplineObservations([
      { id: "t1", dateKey: "2026-08-01", validationState: "VALIDATED" },
      { id: "t2", dateKey: "2026-08-01", validationState: "OVERRIDDEN" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("BREACHED");
  });

  it("stop-widening observations derive from Stage 15 ExecutionDiscrepancyEvent (STOP_WIDENING category), never rebuilt", () => {
    const result = deriveStopWideningObservations([
      { dateKey: "2026-08-01", category: "STOP_WIDENING", description: "SL moved from 1890 to 1880." },
      { dateKey: "2026-08-02", category: "ENTRY_DEGRADATION", description: "irrelevant category" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].dateKey).toBe("2026-08-01");
    expect(result[0].status).toBe("BREACHED");
  });

  it("premature-close observations derive from PREMATURE_CLOSE category only", () => {
    const result = derivePrematureCloseObservations([{ dateKey: "2026-08-03", category: "PREMATURE_CLOSE", description: "Closed before target." }]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("BREACHED");
  });

  it("missed-opportunity observations derive only from CONFIRMED entries", () => {
    const result = deriveMissedOpportunityObservations([{ dateKey: "2026-08-05", replayTradeId: "rt1" }]);
    expect(result).toHaveLength(1);
    expect(result[0].relatedTradeId).toBe("rt1");
  });

  it("behaviour-label observations are breach-only, derived from BEHAVIOUR_LABEL_EVIDENCE category, never other categories", () => {
    const result = deriveBehaviourLabelObservations([
      { dateKey: "2026-08-06", category: "BEHAVIOUR_LABEL_EVIDENCE", description: "Frozen negative label: Revenge trade" },
      { dateKey: "2026-08-07", category: "OVERRIDE_VS_SKIP", description: "irrelevant" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].dateKey).toBe("2026-08-06");
    expect(result[0].status).toBe("BREACHED");
  });

  it("overtrading observations require at least one trade that day — a zero-trade day never counts as FOLLOWED", () => {
    const result = deriveOvertradingObservations([
      { dateKey: "2026-08-01", maxTradesPerDay: 3, tradeCount: 0 },
      { dateKey: "2026-08-02", maxTradesPerDay: 3, tradeCount: 2 },
      { dateKey: "2026-08-03", maxTradesPerDay: 3, tradeCount: 5 },
    ]);
    expect(result.map((r) => r.dateKey)).toEqual(["2026-08-02", "2026-08-03"]);
    expect(result.find((r) => r.dateKey === "2026-08-02")?.status).toBe("FOLLOWED");
    expect(result.find((r) => r.dateKey === "2026-08-03")?.status).toBe("BREACHED");
  });

  it("risk-limit observations exclude days with unmeasurable (null) risk usage entirely, never guessing a clean day", () => {
    const result = deriveRiskLimitObservations([
      { dateKey: "2026-08-01", riskBudgetPercent: 2, riskUsedPercent: null }, // unmeasurable — excluded
      { dateKey: "2026-08-02", riskBudgetPercent: 2, riskUsedPercent: 0 }, // no risk taken — not meaningful evidence
      { dateKey: "2026-08-03", riskBudgetPercent: 2, riskUsedPercent: 1.5 },
      { dateKey: "2026-08-04", riskBudgetPercent: 2, riskUsedPercent: 3 },
    ]);
    expect(result.map((r) => r.dateKey)).toEqual(["2026-08-03", "2026-08-04"]);
    expect(result.find((r) => r.dateKey === "2026-08-03")?.status).toBe("FOLLOWED");
    expect(result.find((r) => r.dateKey === "2026-08-04")?.status).toBe("BREACHED");
  });

  it("none of the new automatic evidence functions accept or reference PnL/realized R in their input types", () => {
    // Structural guarantee: TypeScript's input shapes for these functions carry
    // only rule-relevant counts/booleans/categories — never an R or PnL field.
    const overtrading = deriveOvertradingObservations([{ dateKey: "2026-08-01", maxTradesPerDay: 1, tradeCount: 2 }]);
    const risk = deriveRiskLimitObservations([{ dateKey: "2026-08-01", riskBudgetPercent: 1, riskUsedPercent: 2 }]);
    expect(overtrading[0].status).toBe("BREACHED");
    expect(risk[0].status).toBe("BREACHED");
  });
});

describe("hasAutomaticEvidenceRule — §21 deterministic mapping only, never keyword guessing", () => {
  it("recognizes the known deterministic rule keys, including the Stage 19.1 additions", () => {
    expect(hasAutomaticEvidenceRule("OVERRIDE_DISCIPLINE")).toBe(true);
    expect(hasAutomaticEvidenceRule("STOP_WIDENING_PATTERN")).toBe(true);
    expect(hasAutomaticEvidenceRule("BEHAVIOUR_LABEL_PATTERN")).toBe(true);
    expect(hasAutomaticEvidenceRule("OVERTRADING_DISCIPLINE")).toBe(true);
    expect(hasAutomaticEvidenceRule("RISK_LIMIT_DISCIPLINE")).toBe(true);
  });

  it("returns false for a manual commitment (null sourceFindingType) or an unmapped rule", () => {
    expect(hasAutomaticEvidenceRule(null)).toBe(false);
    expect(hasAutomaticEvidenceRule("SOME_UNRELATED_TEXT_A_TRADER_TYPED")).toBe(false);
  });
});

describe("lineage helpers — §3/§4/§6/§7", () => {
  it("effectiveLineageId falls back to the commitment's own id when it's the lineage root", () => {
    expect(effectiveLineageId({ id: "c1", lineageId: null })).toBe("c1");
  });

  it("effectiveLineageId returns the inherited root id for a continuation", () => {
    expect(effectiveLineageId({ id: "c2", lineageId: "c1" })).toBe("c1");
  });

  it("describeRetirement distinguishes superseded-by-continuation from genuinely dismissed", () => {
    expect(describeRetirement(true)).toBe("SUPERSEDED");
    expect(describeRetirement(false)).toBe("DISMISSED");
  });
});
