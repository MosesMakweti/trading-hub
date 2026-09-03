import { describe, expect, it } from "vitest";

import { hasBlockingIssues, validatePlan } from "@/domain/trade-plan/plan-validation";

describe("validatePlan — required fields", () => {
  it("requires entry, stop, and at least one target", () => {
    const issues = validatePlan({ direction: "LONG", entry: null, stopLoss: null, targets: [] });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("ENTRY_MISSING");
    expect(codes).toContain("STOP_MISSING");
    expect(codes).toContain("TARGET_MISSING");
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("a fully valid long plan has no issues", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "1.1000",
      stopLoss: "1.0980",
      targets: [{ targetOrder: 1, targetPrice: "1.1040", plannedClosePercent: "100" }],
    });
    expect(issues).toHaveLength(0);
  });
});

describe("validatePlan — direction/level relationships", () => {
  it("warns when a long trade's stop is above entry", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "1.1000",
      stopLoss: "1.1050",
      targets: [{ targetOrder: 1, targetPrice: "1.1100", plannedClosePercent: null }],
    });
    expect(issues.find((i) => i.code === "STOP_WRONG_SIDE")).toBeTruthy();
  });

  it("warns when a short trade's target is above entry", () => {
    const issues = validatePlan({
      direction: "SHORT",
      entry: "1.1000",
      stopLoss: "1.1050",
      targets: [{ targetOrder: 1, targetPrice: "1.1100", plannedClosePercent: null }],
    });
    expect(issues.find((i) => i.code === "TARGET_WRONG_SIDE")).toBeTruthy();
  });

  it("does not silently reorder values — a wrong-side stop stays exactly as entered, just flagged", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "110",
      targets: [{ targetOrder: 1, targetPrice: "120", plannedClosePercent: null }],
    });
    // A warning, not an error — the trader corrects it, we don't auto-fix it.
    const stopIssue = issues.find((i) => i.code === "STOP_WRONG_SIDE");
    expect(stopIssue?.severity).toBe("warning");
  });

  it("errors when stop equals entry (zero risk distance)", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "100",
      targets: [{ targetOrder: 1, targetPrice: "110", plannedClosePercent: null }],
    });
    expect(issues.find((i) => i.code === "STOP_EQUALS_ENTRY")?.severity).toBe("error");
  });

  it("errors when a target equals entry (zero reward distance)", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "90",
      targets: [{ targetOrder: 1, targetPrice: "100", plannedClosePercent: null }],
    });
    expect(issues.find((i) => i.code === "TARGET_EQUALS_ENTRY")?.severity).toBe("error");
  });
});

describe("validatePlan — targets", () => {
  it("flags duplicate target prices", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "90",
      targets: [
        { targetOrder: 1, targetPrice: "110", plannedClosePercent: null },
        { targetOrder: 2, targetPrice: "110", plannedClosePercent: null },
      ],
    });
    expect(issues.find((i) => i.code === "DUPLICATE_TARGET")).toBeTruthy();
  });

  it("errors when planned close percentages exceed 100%", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "90",
      targets: [
        { targetOrder: 1, targetPrice: "110", plannedClosePercent: "60" },
        { targetOrder: 2, targetPrice: "120", plannedClosePercent: "60" },
      ],
    });
    expect(issues.find((i) => i.code === "CLOSE_PERCENT_EXCEEDS_100")?.severity).toBe("error");
  });

  it("does not error when close percentages total exactly 100%", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "100",
      stopLoss: "90",
      targets: [
        { targetOrder: 1, targetPrice: "110", plannedClosePercent: "50" },
        { targetOrder: 2, targetPrice: "120", plannedClosePercent: "50" },
      ],
    });
    expect(issues.find((i) => i.code === "CLOSE_PERCENT_EXCEEDS_100")).toBeUndefined();
  });
});

describe("validatePlan — precision", () => {
  it("warns when a price has more decimals than the instrument normally quotes", () => {
    const issues = validatePlan({
      direction: "LONG",
      entry: "1.100003",
      stopLoss: "1.0980",
      targets: [{ targetOrder: 1, targetPrice: "1.1040", plannedClosePercent: null }],
      maxDecimalPrecision: 5,
    });
    expect(issues.find((i) => i.code === "UNREASONABLE_PRECISION")).toBeTruthy();
  });
});
