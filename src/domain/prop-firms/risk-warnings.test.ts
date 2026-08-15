import { describe, expect, it } from "vitest";

import { evaluateAllocationWarnings, hasHardBlock, type AllocationWarningInput } from "@/domain/prop-firms/risk-warnings";

const baseInput: AllocationWarningInput = {
  accountStatus: "ACTIVE",
  stageStatus: "ACTIVE",
  plannedRiskAmount: 1000,
  riskBase: 100_000,
  maxRiskPerTradeRule: null,
  combinedOpenRisk: 0,
  maxRiskPerDayRule: null,
  remainingDailyLossRoom: null,
  remainingDrawdownRoom: null,
  proposedPositionSize: null,
  maxLotOrContractRule: null,
};

describe("evaluateAllocationWarnings", () => {
  it("returns no warnings for a normal, well-within-limits allocation", () => {
    expect(evaluateAllocationWarnings(baseInput)).toEqual([]);
  });

  it("warns when risk exceeds the stage's max risk per trade", () => {
    const warnings = evaluateAllocationWarnings({
      ...baseInput,
      maxRiskPerTradeRule: { numericValue: 0.5 }, // 0.5% max, but 1000/100000 = 1%
    });
    expect(warnings.some((w) => w.code === "MAX_RISK_PER_TRADE_EXCEEDED" && w.severity === "warn")).toBe(true);
  });

  it("warns when combined open risk exceeds max daily/account exposure", () => {
    const warnings = evaluateAllocationWarnings({
      ...baseInput,
      combinedOpenRisk: 4000,
      maxRiskPerDayRule: { numericValue: 3 }, // 3% max, but (4000+1000)/100000 = 5%
    });
    expect(warnings.some((w) => w.code === "MAX_RISK_PER_DAY_EXCEEDED")).toBe(true);
  });

  it("warns when the proposed loss could breach the remaining daily loss room", () => {
    const warnings = evaluateAllocationWarnings({ ...baseInput, remainingDailyLossRoom: 500 });
    expect(warnings.some((w) => w.code === "DAILY_LOSS_ROOM_EXCEEDED")).toBe(true);
  });

  it("warns when the proposed loss could breach the remaining max drawdown room", () => {
    const warnings = evaluateAllocationWarnings({ ...baseInput, remainingDrawdownRoom: 200 });
    expect(warnings.some((w) => w.code === "DRAWDOWN_ROOM_EXCEEDED")).toBe(true);
  });

  it("warns when contract/lot limits are exceeded", () => {
    const warnings = evaluateAllocationWarnings({
      ...baseInput,
      proposedPositionSize: 5,
      maxLotOrContractRule: { numericValue: 2 },
    });
    expect(warnings.some((w) => w.code === "MAX_SIZE_EXCEEDED")).toBe(true);
  });

  it("hard-blocks (never just warns) when the account is failed, breached, or archived", () => {
    for (const status of ["FAILED", "BREACHED", "ARCHIVED"] as const) {
      const warnings = evaluateAllocationWarnings({ ...baseInput, accountStatus: status });
      expect(hasHardBlock(warnings)).toBe(true);
    }
  });

  it("hard-blocks when the stage isn't active", () => {
    const warnings = evaluateAllocationWarnings({ ...baseInput, stageStatus: "PASSED" });
    expect(hasHardBlock(warnings)).toBe(true);
  });

  it("hard-blocks (not just warns) when a HARD_BREACH_TERMINATE rule would be exceeded", () => {
    const warnings = evaluateAllocationWarnings({
      ...baseInput,
      maxRiskPerTradeRule: { numericValue: 0.5, breachAction: "HARD_BREACH_TERMINATE" },
    });
    expect(hasHardBlock(warnings)).toBe(true);
  });

  it("never mutates the input — only reports findings", () => {
    const input = { ...baseInput, maxRiskPerTradeRule: { numericValue: 0.5 } };
    const snapshot = JSON.stringify(input);
    evaluateAllocationWarnings(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
