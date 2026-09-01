import { describe, expect, it } from "vitest";

import {
  isConfluenceEligible,
  scoreConfluences,
  type ScorableConfluence,
} from "./confluence-score";
import { scoreSetup, type SetupConfluence } from "./setup-score";

const cf = (
  name: string,
  weight: number | null,
  directionApplicability: ScorableConfluence["directionApplicability"] = "BOTH",
  mandatory = false,
): ScorableConfluence => ({ id: name, name, weight, mandatory, directionApplicability });

describe("scoreConfluences — direction eligibility", () => {
  const set = [
    cf("Bullish MSB", 40, "BULLISH"),
    cf("Bearish MSB", 40, "BEARISH"),
    cf("At key level", 20, "BOTH"),
  ];

  it("1 — a long trade includes BULLISH + BOTH", () => {
    const r = scoreConfluences({ confluences: set, selectedNames: [], direction: "LONG" });
    expect(r.eligibleConfluenceIds.sort()).toEqual(["At key level", "Bullish MSB"]);
    expect(r.totalEligibleWeight).toBe(60);
  });

  it("2 — a long trade excludes BEARISH (weight + mandatory)", () => {
    const r = scoreConfluences({
      confluences: [...set, cf("Bearish must-have", 30, "BEARISH", true)],
      selectedNames: ["At key level"],
      direction: "LONG",
    });
    expect(r.totalEligibleWeight).toBe(60); // bearish 40 + 30 excluded
    expect(r.missingMandatoryConfluenceIds).toEqual([]); // bearish mandatory irrelevant
    expect(r.mandatoryRequirementsMet).toBe(true);
  });

  it("3 — a short trade includes BEARISH + BOTH", () => {
    const r = scoreConfluences({ confluences: set, selectedNames: [], direction: "SHORT" });
    expect(r.eligibleConfluenceIds.sort()).toEqual(["At key level", "Bearish MSB"]);
    expect(r.totalEligibleWeight).toBe(60);
  });

  it("4 — a short trade excludes BULLISH", () => {
    const r = scoreConfluences({
      confluences: set,
      selectedNames: ["Bullish MSB"],
      direction: "SHORT",
    });
    expect(r.eligibleConfluenceIds).not.toContain("Bullish MSB");
    expect(r.ineligibleSelectedConfluenceNames).toEqual(["Bullish MSB"]);
    expect(r.selectedEligibleWeight).toBe(0);
  });

  it("5 — no direction chosen → nothing eligible, score unavailable", () => {
    const r = scoreConfluences({ confluences: set, selectedNames: ["Bullish MSB"], direction: null });
    expect(r.eligibleConfluenceIds).toEqual([]);
    expect(r.totalEligibleWeight).toBe(0);
    expect(r.score).toBeNull();
    expect(r.mandatoryRequirementsMet).toBe(false);
  });
});

describe("scoreConfluences — weighting", () => {
  it("6/7 — the score uses eligible weights, not confluence count; ineligible weight never enters the denominator", () => {
    // Spec worked example: bull 40, bear 40, both 20. Long eligible = 60.
    // Selected eligible weight 45 → 45 / 60 × 100 = 75.
    const confluences = [
      cf("Bullish A", 40, "BULLISH"),
      cf("Bearish A", 40, "BEARISH"),
      cf("Neutral A", 20, "BOTH"),
    ];
    // 45 = a bull confluence worth 25 + neutral 20 (split the 40 into two for realism)
    const split = [
      cf("Bullish 25", 25, "BULLISH"),
      cf("Bullish 15", 15, "BULLISH"),
      cf("Bearish A", 40, "BEARISH"),
      cf("Neutral 20", 20, "BOTH"),
    ];
    const r = scoreConfluences({
      confluences: split,
      selectedNames: ["Bullish 25", "Neutral 20"],
      direction: "LONG",
    });
    expect(r.totalEligibleWeight).toBe(60);
    expect(r.selectedEligibleWeight).toBe(45);
    expect(r.score).toBe(75);
    // sanity: bearish 40 truly excluded
    expect(confluences.length).toBe(3);
  });

  it("11 — duplicate selections don't increase the score", () => {
    const r = scoreConfluences({
      confluences: [cf("A", 50, "BOTH"), cf("B", 50, "BOTH")],
      selectedNames: ["A", "A", "a", " A "],
      direction: "LONG",
    });
    expect(r.selectedEligibleWeight).toBe(50);
    expect(r.score).toBe(50);
  });

  it("12 — zero eligible weight does not divide by zero", () => {
    const r = scoreConfluences({
      confluences: [cf("A", 0, "BULLISH"), cf("B", null, "BOTH")],
      selectedNames: ["A", "B"],
      direction: "LONG",
    });
    expect(r.totalEligibleWeight).toBe(0);
    expect(r.score).toBeNull();
    expect(r.rating).toBeNull();
  });

  it("clamps negative / non-finite weights to 0", () => {
    const r = scoreConfluences({
      confluences: [cf("A", -20, "BOTH"), cf("B", Number.NaN, "BOTH"), cf("C", 50, "BOTH")],
      selectedNames: ["A", "B", "C"],
      direction: "LONG",
    });
    expect(r.totalEligibleWeight).toBe(50);
    expect(r.selectedEligibleWeight).toBe(50);
    expect(r.score).toBe(100);
  });
});

describe("scoreConfluences — mandatory by direction (8)", () => {
  const set = [
    cf("Bullish core", 30, "BULLISH", true),
    cf("Bearish core", 30, "BEARISH", true),
    cf("Neutral core", 20, "BOTH", true),
  ];

  it("long — only BULLISH + BOTH mandatory count", () => {
    const r = scoreConfluences({ confluences: set, selectedNames: ["Neutral core"], direction: "LONG" });
    expect(r.missingMandatoryConfluenceNames).toEqual(["Bullish core"]);
    expect(r.mandatoryRequirementsMet).toBe(false);
    const ok = scoreConfluences({
      confluences: set,
      selectedNames: ["Bullish core", "Neutral core"],
      direction: "LONG",
    });
    expect(ok.mandatoryRequirementsMet).toBe(true);
  });

  it("short — only BEARISH + BOTH mandatory count", () => {
    const r = scoreConfluences({
      confluences: set,
      selectedNames: ["Bearish core", "Neutral core"],
      direction: "SHORT",
    });
    expect(r.mandatoryRequirementsMet).toBe(true);
    expect(r.missingMandatoryConfluenceNames).toEqual([]);
  });
});

describe("scoreConfluences — legacy (14)", () => {
  it("a confluence with no directionApplicability is treated as BOTH (eligible either way)", () => {
    const legacy: ScorableConfluence[] = [{ id: "x", name: "Legacy", weight: 50, mandatory: false }];
    expect(scoreConfluences({ confluences: legacy, selectedNames: ["Legacy"], direction: "LONG" }).score).toBe(100);
    expect(scoreConfluences({ confluences: legacy, selectedNames: ["Legacy"], direction: "SHORT" }).score).toBe(100);
  });
});

describe("isConfluenceEligible", () => {
  it("BOTH is always eligible when a direction is set", () => {
    expect(isConfluenceEligible("BOTH", "LONG")).toBe(true);
    expect(isConfluenceEligible("BOTH", "SHORT")).toBe(true);
    expect(isConfluenceEligible("BOTH", null)).toBe(false);
  });
  it("directional applicability matches its own direction only", () => {
    expect(isConfluenceEligible("BULLISH", "LONG")).toBe(true);
    expect(isConfluenceEligible("BULLISH", "SHORT")).toBe(false);
    expect(isConfluenceEligible("BEARISH", "SHORT")).toBe(true);
    expect(isConfluenceEligible("BEARISH", "LONG")).toBe(false);
  });
  it("undefined applicability defaults to BOTH", () => {
    expect(isConfluenceEligible(undefined, "SHORT")).toBe(true);
  });
});

describe("scoreSetup wrapper — stays backward compatible + gains direction", () => {
  const strategy: SetupConfluence[] = [
    { name: "Bull MSB", weight: 40, mandatory: false, directionApplicability: "BULLISH" },
    { name: "Bear MSB", weight: 40, mandatory: false, directionApplicability: "BEARISH" },
    { name: "Key level", weight: 20, mandatory: false, directionApplicability: "BOTH" },
  ];

  it("without opts: every confluence eligible (legacy behaviour)", () => {
    const r = scoreSetup(strategy, ["Bull MSB", "Key level"]);
    expect(r.totalWeight).toBe(100); // all three counted
    expect(r.completedWeight).toBe(60);
    expect(r.setupScore).toBe(60);
  });

  it("with direction LONG: bearish weight leaves the denominator", () => {
    const r = scoreSetup(strategy, ["Bull MSB", "Key level"], { direction: "LONG" });
    expect(r.totalWeight).toBe(60);
    expect(r.completedWeight).toBe(60);
    expect(r.setupScore).toBe(100);
    expect(r.ineligibleSelected).toEqual([]);
  });

  it("with direction: a stale bearish selection is reported ineligible, not scored", () => {
    const r = scoreSetup(strategy, ["Bear MSB", "Key level"], { direction: "LONG" });
    expect(r.ineligibleSelected).toEqual(["Bear MSB"]);
    expect(r.completedWeight).toBe(20); // only Key level
    expect(r.setupScore).toBe(33); // 20 / 60
  });

  it("with direction null: score unavailable", () => {
    const r = scoreSetup(strategy, ["Bull MSB"], { direction: null });
    expect(r.setupScore).toBeNull();
    expect(r.totalWeight).toBe(0);
    expect(r.setupValid).toBe(false);
  });
});
