import { describe, expect, it } from "vitest";

import {
  buildAlignmentFlags,
  compareEntry,
  compareRiskAndResult,
  compareStop,
  compareTargets,
} from "@/domain/trade-plan/plan-execution-comparison";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";

const eurusd = lookupInstrument("EURUSD");
const nq = lookupInstrument("NQ");

describe("compareEntry", () => {
  it("flags adverse slippage for a long entered above plan", () => {
    const result = compareEntry("LONG", "1.10000", "1.10020", eurusd, "0.00200");
    expect(result.label).toBe("WORSE_THAN_PLANNED");
    expect(result.signedSlippage?.toNumber()).toBeCloseTo(0.0002, 6);
    expect(result.distance?.unit).toBe("PIP");
    expect(result.distance?.distance.toNumber()).toBeCloseTo(2, 6);
    expect(result.slippageR?.toNumber()).toBeCloseTo(0.1, 6); // 0.0002 / 0.0020
  });

  it("flags favorable slippage for a long entered below plan", () => {
    const result = compareEntry("LONG", "1.10000", "1.09980", eurusd, "0.00200");
    expect(result.label).toBe("BETTER_THAN_PLANNED");
    expect(result.signedSlippage?.toNumber()).toBeCloseTo(-0.0002, 6);
  });

  it("flags adverse slippage for a short entered below plan", () => {
    const result = compareEntry("SHORT", "1.10000", "1.09980", eurusd, "0.00200");
    expect(result.label).toBe("WORSE_THAN_PLANNED");
  });

  it("flags favorable slippage for a short entered above plan", () => {
    const result = compareEntry("SHORT", "1.10000", "1.10020", eurusd, "0.00200");
    expect(result.label).toBe("BETTER_THAN_PLANNED");
  });

  it("uses instrument precision tolerance — a sub-pip difference is AT_PLANNED_LEVEL, not slippage", () => {
    // Half a pip for EURUSD is 0.00005; a 0.00002 difference must not be classified as slippage.
    const result = compareEntry("LONG", "1.10000", "1.10002", eurusd, "0.00200");
    expect(result.label).toBe("AT_PLANNED_LEVEL");
  });

  it("returns NOT_ENOUGH_DATA when the actual entry is missing", () => {
    const result = compareEntry("LONG", "1.10000", null, eurusd, "0.00200");
    expect(result.label).toBe("NOT_ENOUGH_DATA");
    expect(result.signedSlippage).toBeNull();
  });

  it("computes slippage in R only when a planned risk distance is available", () => {
    const result = compareEntry("LONG", "1.10000", "1.10020", eurusd, null);
    expect(result.slippageR).toBeNull();
    expect(result.label).toBe("WORSE_THAN_PLANNED"); // still classifiable without R
  });

  it("handles a futures instrument (ticks) correctly", () => {
    const result = compareEntry("LONG", "20000", "20001", nq, "40"); // 1 tick worse
    expect(result.distance?.unit).toBe("TICK");
    expect(result.distance?.distance.toNumber()).toBeCloseTo(4, 6); // 1 / 0.25
  });
});

describe("compareStop", () => {
  it("detects a widened actual risk distance", () => {
    // Planned: entry 1.1000, stop 1.0980 -> 20 pips. Actual: entry 1.1000, stop 1.0975 -> 25 pips.
    const result = compareStop("1.10000", "1.09800", "1.10000", "1.09750", eurusd);
    expect(result.change).toBe("WIDENED");
    expect(result.riskRatio?.toNumber()).toBeCloseTo(1.25, 2);
  });

  it("detects a tightened actual risk distance", () => {
    const result = compareStop("1.10000", "1.09800", "1.10000", "1.09900", eurusd);
    expect(result.change).toBe("TIGHTENED");
  });

  it("reports RESPECTED when actual risk distance matches plan within tolerance", () => {
    const result = compareStop("1.10000", "1.09800", "1.10000", "1.09801", eurusd);
    expect(result.change).toBe("RESPECTED");
  });

  it("uses the ACTUAL entry (not planned) to compute actual risk distance", () => {
    // Entry slipped 5 pips worse but stop distance from the actual entry is unchanged (20 pips) -> respected.
    const result = compareStop("1.10000", "1.09800", "1.10050", "1.09850", eurusd);
    expect(result.change).toBe("RESPECTED");
  });

  it("is NOT_ENOUGH_DATA when the actual stop was never recorded — never inferred from the exit", () => {
    const result = compareStop("1.10000", "1.09800", "1.10000", null, eurusd);
    expect(result.change).toBe("NOT_ENOUGH_DATA");
    expect(result.actualStopUsed).toBeNull();
    expect(result.actualRiskDistance).toBeNull();
  });
});

describe("compareTargets", () => {
  const targets = [
    { targetOrder: 1, label: "TP1", targetPrice: "1.10700", rMultiple: "1" },
    { targetOrder: 2, label: "TP2", targetPrice: "1.10900", rMultiple: "2" },
  ];

  it("matches the final exit to exactly one target when the price aligns", () => {
    const result = compareTargets("LONG", "1.10500", "1.10700", "0.00200", targets, eurusd);
    expect(result.matchedTarget?.label).toBe("TP1");
    expect(result.rows.filter((r) => r.matchedFinalExit)).toHaveLength(1);
  });

  it("a correctly executed loss (-1R) is not flagged as poor execution — it's just a realized R below zero", () => {
    const result = compareTargets("LONG", "1.10500", "1.10300", "0.00200", targets, eurusd);
    expect(result.realizedR?.toNumber()).toBeCloseTo(-1, 6);
    expect(result.matchedTarget).toBeNull(); // didn't match either target — no fabricated claim
    // No "quality" field exists on the result at all — only descriptive R/distance data.
    expect(Object.keys(result)).not.toContain("qualityScore");
    expect(Object.keys(result)).not.toContain("executionGrade");
  });

  it("does not claim a target was reached when the exit price is beyond it (no price-path proof)", () => {
    // Exit at 1.1100 is beyond TP2 (1.1090) — must NOT be reported as "TP2 reached".
    const result = compareTargets("LONG", "1.10500", "1.11000", "0.00200", targets, eurusd);
    expect(result.matchedTarget).toBeNull();
  });

  it("prefers a confirmed realized R over the price-derived estimate", () => {
    const result = compareTargets("LONG", "1.10500", "1.10700", "0.00200", targets, eurusd, "1.4");
    expect(result.realizedR?.toNumber()).toBeCloseTo(1.4, 6);
  });

  it("captured distance is null without both actual entry and exit", () => {
    const result = compareTargets("LONG", "1.10500", null, "0.00200", targets, eurusd);
    expect(result.capturedDistance).toBeNull();
    expect(result.realizedR).toBeNull();
  });
});

describe("compareRiskAndResult", () => {
  it("passes through only the values provided, decimal-safe", () => {
    const result = compareRiskAndResult({ plannedWeightedR: "2", realizedR: "1.4", actualNetPnl: "1400" });
    expect(result.plannedWeightedR?.toNumber()).toBe(2);
    expect(result.realizedR?.toNumber()).toBe(1.4);
    expect(result.plannedRiskAmount).toBeNull();
  });
});

describe("buildAlignmentFlags", () => {
  it("never uses 'Planned Target R minus Actual R' as an execution-quality formula — flags are independent, descriptive facts", () => {
    const entry = compareEntry("LONG", "1.10000", "1.10000", eurusd, "0.00200");
    const stop = compareStop("1.10000", "1.09800", "1.10000", "1.09800", eurusd);
    const flags = buildAlignmentFlags(entry, stop);
    expect(flags.map((f) => f.code)).toEqual(["ENTRY_ALIGNED", "PLANNED_RISK_RESPECTED"]);
    // Every flag is a fact about entry/stop alignment, never a "poor execution" verdict.
    expect(flags.every((f) => !/poor|bad|error|mistake/i.test(f.message))).toBe(true);
  });

  it("flags missing actual-stop data honestly instead of guessing", () => {
    const entry = compareEntry("LONG", "1.10000", "1.10000", eurusd, "0.00200");
    const stop = compareStop("1.10000", "1.09800", "1.10000", null, eurusd);
    const flags = buildAlignmentFlags(entry, stop);
    expect(flags.find((f) => f.code === "STOP_DATA_MISSING")).toBeTruthy();
  });
});
