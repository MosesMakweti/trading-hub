/**
 * Decimal-safe risk math for Trade Account Executions (spec §1, §3, §4).
 * Deliberately deviates from metrics.ts's "plain numbers in/out" convention —
 * that convention predates this phase's decimal-safety requirement, and
 * financial per-trade math (risk amounts, R-multiples, PnL) must not
 * accumulate plain-float error the way `.toNumber()` + `-`/`*` would. Every
 * monetary/percentage parameter here accepts `Decimal.Value` (string | number
 * | Decimal); anything that feeds further calculation is returned as a
 * `Decimal`. `.toNumber()` happens only at the DTO edge (prop-firms.mapper.ts).
 */
import { Decimal } from "decimal.js";

export type RiskEntryModeLike = "PERCENT" | "AMOUNT" | "FIXED_SIZE";
export type RiskBasisLike = "CURRENT_BALANCE" | "CURRENT_EQUITY" | "STAGE_STARTING_BALANCE";
export type DirectionLike = "LONG" | "SHORT";

export const DEFAULT_RISK_BASIS: RiskBasisLike = "CURRENT_BALANCE";

export interface RiskBasisInputs {
  currentBalance: Decimal.Value;
  /** null when the account has no live equity feed — falls back to currentBalance. */
  currentEquity: Decimal.Value | null;
  stageStartingBalance: Decimal.Value;
}

/** Resolves the selected risk base to a concrete amount. CURRENT_EQUITY falls
 *  back to currentBalance when equity isn't available (spec: "when present
 *  it's preferred by equity-based rules, otherwise the ledger balance is used
 *  as the equity proxy"). */
export function resolveRiskBase(basis: RiskBasisLike, inputs: RiskBasisInputs): Decimal {
  switch (basis) {
    case "CURRENT_EQUITY":
      return new Decimal(inputs.currentEquity ?? inputs.currentBalance);
    case "STAGE_STARTING_BALANCE":
      return new Decimal(inputs.stageStartingBalance);
    case "CURRENT_BALANCE":
    default:
      return new Decimal(inputs.currentBalance);
  }
}

export class FixedSizeRiskAmountError extends Error {
  constructor() {
    super(
      "FIXED_SIZE risk entries don't derive a planned risk amount from a base — compute it via position-sizing's reverse calc (risk amount = position size × stop distance × pip/tick value) instead.",
    );
    this.name = "FixedSizeRiskAmountError";
  }
}

/** Planned Risk Amount = Selected Risk Base × Risk% / 100 (PERCENT), or the
 *  entered dollar amount as-is (AMOUNT). FIXED_SIZE has no base-derived
 *  amount — see FixedSizeRiskAmountError. */
export function plannedRiskAmount(mode: RiskEntryModeLike, inputValue: Decimal.Value, base: Decimal): Decimal {
  const value = new Decimal(inputValue);
  switch (mode) {
    case "PERCENT":
      return base.times(value).dividedBy(100);
    case "AMOUNT":
      return value;
    case "FIXED_SIZE":
      throw new FixedSizeRiskAmountError();
  }
}

export interface PlannedPricesInput {
  plannedEntry: Decimal.Value | null;
  plannedStopLoss: Decimal.Value | null;
  plannedTarget: Decimal.Value | null;
}

export interface PlannedPricesOverride {
  plannedEntryOverride: Decimal.Value | null;
  plannedStopLossOverride: Decimal.Value | null;
  plannedTargetOverride: Decimal.Value | null;
}

export interface ResolvedPlannedPrices {
  entry: Decimal | null;
  stopLoss: Decimal | null;
  target: Decimal | null;
}

/** Override-or-inherit: an execution's plan defaults to the Trade Idea's
 *  shared plan, but a CFD vs. futures execution of the same idea can
 *  legitimately need different instrument prices. */
export function resolvePlannedPrices(idea: PlannedPricesInput, overrides: PlannedPricesOverride): ResolvedPlannedPrices {
  const pick = (override: Decimal.Value | null, fallback: Decimal.Value | null): Decimal | null => {
    const chosen = override ?? fallback;
    return chosen == null ? null : new Decimal(chosen);
  };
  return {
    entry: pick(overrides.plannedEntryOverride, idea.plannedEntry),
    stopLoss: pick(overrides.plannedStopLossOverride, idea.plannedStopLoss),
    target: pick(overrides.plannedTargetOverride, idea.plannedTarget),
  };
}

export interface PlannedRSummary {
  plannedR: Decimal | null;
  reason?: string;
}

/** Planned R = reward distance / risk distance, direction-aware. Null (with a
 *  reason) rather than a fabricated value when any resolved price is missing
 *  or the stop is on the wrong side of entry (zero/invalid risk distance). */
export function computePlannedR(direction: DirectionLike, entry: Decimal | null, stopLoss: Decimal | null, target: Decimal | null): PlannedRSummary {
  if (entry == null || stopLoss == null || target == null) {
    return { plannedR: null, reason: "Planned entry, stop, and target are all required to compute planned R." };
  }
  const riskDistance = direction === "LONG" ? entry.minus(stopLoss) : stopLoss.minus(entry);
  const rewardDistance = direction === "LONG" ? target.minus(entry) : entry.minus(target);
  if (!riskDistance.greaterThan(0)) {
    return { plannedR: null, reason: "Stop loss must be on the risk side of entry to compute planned R." };
  }
  return { plannedR: rewardDistance.dividedBy(riskDistance) };
}

/** Net PnL = Gross − Commission − Swap/Financing − Other Fees. Null when
 *  gross isn't known yet (nothing to net down). */
export function computeNetPnl(
  gross: Decimal.Value | null,
  commission: Decimal.Value | null,
  swap: Decimal.Value | null,
  otherFees: Decimal.Value | null,
): Decimal | null {
  if (gross == null) return null;
  return new Decimal(gross)
    .minus(commission ?? 0)
    .minus(swap ?? 0)
    .minus(otherFees ?? 0);
}

/** Actual R = Net PnL / Planned Risk Amount. Null when net PnL isn't known or
 *  the planned risk amount is zero/negative (nothing meaningful to divide by
 *  — never a fabricated Infinity). */
export function computeActualR(netPnl: Decimal.Value | null, riskAmount: Decimal.Value): Decimal | null {
  if (netPnl == null) return null;
  const risk = new Decimal(riskAmount);
  if (!risk.greaterThan(0)) return null;
  return new Decimal(netPnl).dividedBy(risk);
}

export interface EstimatedPnlResult {
  netPnl: Decimal;
  isEstimated: true;
}

/** Estimated Net PnL = Actual R × Planned Risk Amount — used only when real
 *  broker PnL isn't available yet but the trader entered actual R. Always
 *  marked estimated so it's visibly replaced once real PnL is confirmed
 *  (spec §4: "the actual broker PnL is the source of truth"). */
export function estimateNetPnlFromActualR(actualR: Decimal.Value, riskAmount: Decimal.Value): EstimatedPnlResult {
  return { netPnl: new Decimal(actualR).times(riskAmount), isEstimated: true };
}
