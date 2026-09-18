import { describe, expect, it } from "vitest";

import {
  computeCompoundedBalance,
  computeInitialRiskDistance,
  needsExplicitInitialStopConfirmation,
  computePerformancePnl,
  computePerformanceRiskAmount,
  computeRealizedR,
  resolveInitialStop,
} from "./realized-r";

describe("resolveInitialStop", () => {
  it("prefers the confirmed actual stop over the locked planned stop and the canonical planned stop", () => {
    expect(resolveInitialStop(1.095, 1.09, 1.08)).toEqual({ stop: expect.anything(), source: "ACTUAL" });
    expect(resolveInitialStop(1.095, 1.09, 1.08).stop!.toNumber()).toBe(1.095);
  });

  it("falls back to the locked planned stop when no actual stop was entered", () => {
    const result = resolveInitialStop(null, 1.09, 1.08);
    expect(result.source).toBe("PLANNED");
    expect(result.stop!.toNumber()).toBe(1.09);
  });

  // Stage C.1 — third tier: the simple case-file plannedStopLoss field, used
  // only when neither an actual stop nor a locked TradePlanVersion exists
  // (e.g. a freeform trade with no TradingView screenshot plan).
  it("falls back to the canonical planned stop when neither an actual nor a locked plan stop exists", () => {
    const result = resolveInitialStop(null, null, 1.08);
    expect(result.source).toBe("PLANNED_FALLBACK");
    expect(result.stop!.toNumber()).toBe(1.08);
  });

  it("resolves to null when none of the three sources exist", () => {
    expect(resolveInitialStop(null, null, null)).toEqual({ stop: null, source: null });
  });
});

describe("computeInitialRiskDistance", () => {
  it("is entry minus stop for a long", () => {
    expect(computeInitialRiskDistance("LONG", 1.1, 1.095).toNumber()).toBeCloseTo(0.005, 8);
  });

  it("is stop minus entry for a short", () => {
    expect(computeInitialRiskDistance("SHORT", 1.095, 1.1).toNumber()).toBeCloseTo(0.005, 8);
  });

  it("is non-positive when the stop is on the wrong side of entry", () => {
    expect(computeInitialRiskDistance("LONG", 1.1, 1.105).toNumber()).toBeLessThan(0);
  });
});

describe("computeRealizedR — single exit", () => {
  it("full planned stop is approximately -1R (long)", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [{ price: 1.095, proportion: 100 }]);
    expect(r.fullyClosed).toBe(true);
    expect(r.realizedR!.toNumber()).toBeCloseTo(-1, 8);
  });

  it("breakeven exit is 0R", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [{ price: 1.1, proportion: 100 }]);
    expect(r.realizedR!.toNumber()).toBeCloseTo(0, 8);
  });

  it("exit at twice the risk distance is +2R (long)", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [{ price: 1.11, proportion: 100 }]);
    expect(r.realizedR!.toNumber()).toBeCloseTo(2, 8);
  });

  it("exit at half the risk distance is +0.5R (long)", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [{ price: 1.1025, proportion: 100 }]);
    expect(r.realizedR!.toNumber()).toBeCloseTo(0.5, 8);
  });

  it("mirrors correctly for a short trade", () => {
    // Short: entry 1.10, stop 1.105 (risk distance 0.005), exit at 1.09 -> +2R.
    const r = computeRealizedR("SHORT", 1.1, 1.105, [{ price: 1.09, proportion: 100 }]);
    expect(r.realizedR!.toNumber()).toBeCloseTo(2, 8);
  });

  it("a full −1R loss lands exactly on -1", () => {
    // Short: entry 1.10, stop 1.105 (above entry, as required for a short).
    const r = computeRealizedR("SHORT", 1.1, 1.105, [{ price: 1.105, proportion: 100 }]);
    expect(r.realizedR!.toNumber()).toBeCloseTo(-1, 8);
  });
});

describe("computeRealizedR — partial exits", () => {
  it("weights each partial by its proportion closed (the spec's worked example)", () => {
    // 50% closed at +1R, 50% closed at +2R -> 1.5R weighted.
    // Long: entry 1.10, stop 1.095 (risk 0.005). +1R = 1.105, +2R = 1.11.
    const r = computeRealizedR("LONG", 1.1, 1.095, [
      { price: 1.105, proportion: 50 },
      { price: 1.11, proportion: 50 },
    ]);
    expect(r.fullyClosed).toBe(true);
    expect(r.realizedR!.toNumber()).toBeCloseTo(1.5, 8);
  });

  it("does not settle while exposure remains open (partials < 100%)", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [{ price: 1.105, proportion: 50 }]);
    expect(r.fullyClosed).toBe(false);
    expect(r.realizedR).toBeNull();
    expect(r.totalProportionClosed.toNumber()).toBe(50);
  });

  it("rejects partials totaling over 100%", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, [
      { price: 1.105, proportion: 60 },
      { price: 1.11, proportion: 60 },
    ]);
    expect(r.fullyClosed).toBe(false);
    expect(r.realizedR).toBeNull();
    expect(r.reason).toMatch(/exceeds 100%/);
  });
});

describe("computeRealizedR — invalid inputs", () => {
  it("refuses to compute when the initial risk distance is not positive", () => {
    const r = computeRealizedR("LONG", 1.1, 1.105, [{ price: 1.11, proportion: 100 }]);
    expect(r.realizedR).toBeNull();
    expect(r.fullyClosed).toBe(false);
    expect(r.reason).toMatch(/greater than zero/);
  });

  it("returns not-fully-closed with no exits", () => {
    const r = computeRealizedR("LONG", 1.1, 1.095, []);
    expect(r.fullyClosed).toBe(false);
    expect(r.realizedR).toBeNull();
  });
});

describe("computePerformanceRiskAmount", () => {
  it("is balance before × risk% / 100 (the spec's worked example)", () => {
    expect(computePerformanceRiskAmount(100_000, 1).toNumber()).toBe(1000);
  });
});

describe("computePerformancePnl", () => {
  it("is risk amount × realized R for a win", () => {
    expect(computePerformancePnl(1000, 2).toNumber()).toBe(2000);
  });

  it("is negative for a loss", () => {
    expect(computePerformancePnl(1000, -1).toNumber()).toBe(-1000);
  });
});

describe("computeCompoundedBalance — the spec's two-trade worked example", () => {
  it("trade 1: 100k -> 102k after +2R at 1% risk", () => {
    const riskAmount = computePerformanceRiskAmount(100_000, 1);
    expect(riskAmount.toNumber()).toBe(1000);
    const pnl = computePerformancePnl(riskAmount, 2);
    expect(pnl.toNumber()).toBe(2000);
    const after = computeCompoundedBalance(100_000, pnl);
    expect(after.toNumber()).toBe(102_000);
  });

  it("trade 2: 102k -> 100,980 after -1R at 1% risk of the new balance", () => {
    const riskAmount = computePerformanceRiskAmount(102_000, 1);
    expect(riskAmount.toNumber()).toBe(1020);
    const pnl = computePerformancePnl(riskAmount, -1);
    expect(pnl.toNumber()).toBe(-1020);
    const after = computeCompoundedBalance(102_000, pnl);
    expect(after.toNumber()).toBe(100_980);
  });
});

// Today V2 Final Phase §2 — closing the planless late-stop-entry ambiguity
// through an explicit interaction rule rather than a stop-event system.
describe("needsExplicitInitialStopConfirmation", () => {
  it("requires confirmation once execution begins with no plan and no resolved initial stop", () => {
    expect(
      needsExplicitInitialStopConfirmation({
        hasActualEntry: true,
        hasTrustworthyPlannedStop: false,
        initialStopResolved: false,
      }),
    ).toBe(true);
  });

  it("never requires it before execution begins", () => {
    expect(
      needsExplicitInitialStopConfirmation({
        hasActualEntry: false,
        hasTrustworthyPlannedStop: false,
        initialStopResolved: false,
      }),
    ).toBe(false);
  });

  it("never requires it when a trustworthy planned/locked stop exists to inherit", () => {
    expect(
      needsExplicitInitialStopConfirmation({
        hasActualEntry: true,
        hasTrustworthyPlannedStop: true,
        initialStopResolved: false,
      }),
    ).toBe(false);
  });

  it("stops requiring it once an initial stop has actually been resolved", () => {
    expect(
      needsExplicitInitialStopConfirmation({
        hasActualEntry: true,
        hasTrustworthyPlannedStop: false,
        initialStopResolved: true,
      }),
    ).toBe(false);
  });
});
