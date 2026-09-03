import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  computeActualR,
  computeNetPnl,
  computePlannedR,
  estimateNetPnlFromActualR,
  FixedSizeRiskAmountError,
  plannedRiskAmount,
  resolvePlannedPrices,
  resolveRiskBase,
} from "@/domain/prop-firms/risk";

describe("resolveRiskBase", () => {
  const inputs = { currentBalance: 100_000, currentEquity: 98_500, stageStartingBalance: 100_000 };

  it("CURRENT_BALANCE returns the current balance", () => {
    expect(resolveRiskBase("CURRENT_BALANCE", inputs).toNumber()).toBe(100_000);
  });

  it("CURRENT_EQUITY returns equity when present", () => {
    expect(resolveRiskBase("CURRENT_EQUITY", inputs).toNumber()).toBe(98_500);
  });

  it("CURRENT_EQUITY falls back to current balance when equity is null", () => {
    expect(resolveRiskBase("CURRENT_EQUITY", { ...inputs, currentEquity: null }).toNumber()).toBe(100_000);
  });

  it("STAGE_STARTING_BALANCE returns the stage's starting balance", () => {
    expect(resolveRiskBase("STAGE_STARTING_BALANCE", { ...inputs, stageStartingBalance: 50_000 }).toNumber()).toBe(50_000);
  });
});

describe("plannedRiskAmount", () => {
  const base = new Decimal(100_000);

  it("PERCENT: base × value/100", () => {
    expect(plannedRiskAmount("PERCENT", 1, base).toNumber()).toBe(1_000);
    expect(plannedRiskAmount("PERCENT", 0.5, base).toNumber()).toBe(500);
  });

  it("AMOUNT: the entered value as-is", () => {
    expect(plannedRiskAmount("AMOUNT", 750, base).toNumber()).toBe(750);
  });

  it("FIXED_SIZE throws — no base-derived amount exists for a fixed lot/contract entry", () => {
    expect(() => plannedRiskAmount("FIXED_SIZE", 2, base)).toThrow(FixedSizeRiskAmountError);
  });

  it("keeps decimal precision across chained percent math (no float drift)", () => {
    // 0.1% of 100,000 repeated three times must sum exactly to 300, not 299.99999999999994.
    const third = plannedRiskAmount("PERCENT", 0.1, base);
    const sum = third.plus(third).plus(third);
    expect(sum.toString()).toBe("300");
  });
});

describe("resolvePlannedPrices", () => {
  const idea = { plannedEntry: 100, plannedStopLoss: 95, plannedTarget: 115 };

  it("inherits the idea's plan when no override is set", () => {
    const resolved = resolvePlannedPrices(idea, { plannedEntryOverride: null, plannedStopLossOverride: null, plannedTargetOverride: null });
    expect(resolved.entry?.toNumber()).toBe(100);
    expect(resolved.stopLoss?.toNumber()).toBe(95);
    expect(resolved.target?.toNumber()).toBe(115);
  });

  it("uses a per-execution override when set (e.g. a futures execution priced differently than the CFD idea)", () => {
    const resolved = resolvePlannedPrices(idea, {
      plannedEntryOverride: 4500,
      plannedStopLossOverride: 4480,
      plannedTargetOverride: null,
    });
    expect(resolved.entry?.toNumber()).toBe(4500);
    expect(resolved.stopLoss?.toNumber()).toBe(4480);
    expect(resolved.target?.toNumber()).toBe(115); // inherited
  });
});

describe("computePlannedR", () => {
  it("LONG: reward/risk distance", () => {
    const r = computePlannedR("LONG", new Decimal(100), new Decimal(95), new Decimal(115));
    expect(r.plannedR?.toNumber()).toBe(3); // 15 reward / 5 risk
  });

  it("SHORT: reward/risk distance mirrored", () => {
    const r = computePlannedR("SHORT", new Decimal(100), new Decimal(105), new Decimal(85));
    expect(r.plannedR?.toNumber()).toBe(3); // 15 reward / 5 risk
  });

  it("is null with a reason when a price is missing", () => {
    const r = computePlannedR("LONG", new Decimal(100), null, new Decimal(115));
    expect(r.plannedR).toBeNull();
    expect(r.reason).toBeTruthy();
  });

  it("is null with a reason when the stop is on the wrong side of entry", () => {
    const r = computePlannedR("LONG", new Decimal(100), new Decimal(105), new Decimal(115));
    expect(r.plannedR).toBeNull();
    expect(r.reason).toMatch(/risk side/);
  });
});

describe("computeNetPnl", () => {
  it("Gross − Commission − Swap − OtherFees", () => {
    expect(computeNetPnl(1000, 10, 5, 2)?.toNumber()).toBe(983);
  });

  it("treats missing fee fields as 0", () => {
    expect(computeNetPnl(1000, null, null, null)?.toNumber()).toBe(1000);
  });

  it("is null when gross is unknown", () => {
    expect(computeNetPnl(null, 10, 5, 2)).toBeNull();
  });
});

describe("computeActualR", () => {
  it("Net PnL / Planned Risk Amount", () => {
    expect(computeActualR(2000, 1000)?.toNumber()).toBe(2);
    expect(computeActualR(-500, 1000)?.toNumber()).toBe(-0.5);
  });

  it("is null when net PnL is unknown", () => {
    expect(computeActualR(null, 1000)).toBeNull();
  });

  it("is null (not Infinity) when the risk amount is zero or negative", () => {
    expect(computeActualR(500, 0)).toBeNull();
    expect(computeActualR(500, -100)).toBeNull();
  });
});

describe("estimateNetPnlFromActualR", () => {
  it("Actual R × Planned Risk Amount, marked estimated", () => {
    const result = estimateNetPnlFromActualR(2.5, 1000);
    expect(result.netPnl.toNumber()).toBe(2500);
    expect(result.isEstimated).toBe(true);
  });
});
