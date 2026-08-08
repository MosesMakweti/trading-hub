import { describe, expect, it } from "vitest";

import {
  aggregateDeviationCauses,
  computeDeviations,
  type DeviationInput,
} from "./deviation-engine";

const base: DeviationInput = {
  direction: "LONG",
  plannedEntry: 100,
  plannedStopLoss: 99, // 1R = 1.0 price
  plannedTarget: 103,
  actualEntry: 100,
  actualExit: 103,
  actualRR: 3,
};

describe("computeDeviations", () => {
  it("flags a chased (late) entry, costed in R", () => {
    const { primary } = computeDeviations({ ...base, actualEntry: 100.5 });
    expect(primary).toMatchObject({ cause: "late-entry", costR: 0.5 });
  });

  it("flags a premature exit on a winner", () => {
    const { primary } = computeDeviations({ ...base, actualExit: 101.5, actualRR: 1.5 });
    expect(primary).toMatchObject({ cause: "premature-exit", costR: 1.5 }); // 103 − 101.5
  });

  it("flags a loss overrun past the stop", () => {
    const { primary } = computeDeviations({ ...base, actualExit: 98, actualRR: -2 });
    expect(primary).toMatchObject({ cause: "loss-overrun", costR: 1 }); // 99 − 98
  });

  it("flags increased risk vs plan", () => {
    const { primary } = computeDeviations({
      ...base,
      plannedRiskPercent: 1,
      actualRiskPercent: 2,
    });
    expect(primary).toMatchObject({ cause: "increased-risk", costR: 1 }); // (2−1)/1
  });

  it("picks the largest as primary and lists the rest", () => {
    const r = computeDeviations({
      ...base,
      actualEntry: 100.3, // late-entry 0.3
      actualExit: 101, // premature 2.0
      actualRR: 1,
    });
    expect(r.primary?.cause).toBe("premature-exit");
    expect(r.deviations.map((d) => d.cause)).toEqual(["premature-exit", "late-entry"]);
  });

  it("returns no deviation for an on-plan trade", () => {
    expect(computeDeviations(base).primary).toBeNull();
  });

  it("is robust to missing planned/actual data", () => {
    expect(
      computeDeviations({ ...base, plannedStopLoss: null, actualExit: null }).deviations,
    ).toEqual([]);
  });
});

describe("aggregateDeviationCauses", () => {
  it("counts occurrences and sums R-cost per cause, ranked by total cost", () => {
    const stats = aggregateDeviationCauses([
      { cause: "premature-exit", label: "Premature exit", costR: 1.5 },
      { cause: "premature-exit", label: "Premature exit", costR: 0.5 },
      { cause: "late-entry", label: "Late / chased entry", costR: 0.3 },
      null,
    ]);
    expect(stats[0]).toMatchObject({
      cause: "premature-exit",
      occurrences: 2,
      totalCostR: 2,
      avgCostR: 1,
    });
    expect(stats[1]).toMatchObject({ cause: "late-entry", occurrences: 1, totalCostR: 0.3 });
  });
});
