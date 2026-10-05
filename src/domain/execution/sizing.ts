/**
 * Quantity-ledger execution engine (Phase 1) — position sizing. Pure.
 *
 *   Risk % determines the budget.
 *   Initial stop + instrument economics determine executable quantity.
 *
 *   intendedRiskAmount  = balanceBasis × riskPercent / 100   (money, rounded DOWN)
 *   lossPerQuantityUnit = |entry − initialStop| × accountValuePerPriceUnit
 *   rawQuantity         = intendedRiskAmount / lossPerQuantityUnit
 *   executableQuantity  = rawQuantity quantized DOWN to quantityStep,
 *                         then capped at maxQuantity (never raised)
 *   effectiveRiskAmount = executableQuantity × lossPerQuantityUnit  (≤ intended)
 *
 * Quantity is never raised to reach minQuantity — that would risk more than
 * the budget; the result is CANNOT_SIZE_WITHIN_RISK instead. The intended
 * amount stays the R denominator; effective risk is reported separately.
 */
import type { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";
import type { ResolvedExecutionSpec } from "./instrument-spec";
import { DEFAULT_MONEY_SCALE, dec, floorMoney, quantizeDown, type DecimalInput } from "./precision";

export interface SizePositionInput {
  direction: DirectionLike;
  balanceBasis: DecimalInput;
  riskPercent: DecimalInput;
  entry: DecimalInput;
  initialStop: DecimalInput;
  spec: Pick<ResolvedExecutionSpec, "quantityStep" | "minQuantity" | "maxQuantity">;
  /** From computeValuePerPriceUnit (account currency). */
  accountValuePerPriceUnit: DecimalInput;
  /** Account-currency minor units for the budget; null = exact. */
  moneyScale?: number | null;
}

export type SizePositionResult =
  | {
      status: "SIZED";
      intendedRiskAmount: Decimal;
      stopDistance: Decimal;
      lossPerQuantityUnit: Decimal;
      rawQuantity: Decimal;
      executableQuantity: Decimal;
      effectiveRiskAmount: Decimal;
      /** intended − effective (≥ 0): budget left unused by step/max rounding. */
      riskShortfall: Decimal;
      cappedAtMax: boolean;
    }
  | {
      status: "CANNOT_SIZE_WITHIN_RISK";
      reason: "BELOW_MIN_QUANTITY";
      intendedRiskAmount: Decimal;
      lossPerQuantityUnit: Decimal;
      rawQuantity: Decimal;
      minQuantity: Decimal;
      /** What trading the minimum would actually risk (> intended). */
      riskAtMinQuantity: Decimal;
    }
  | { status: "INVALID"; reason: string };

export function sizePosition(input: SizePositionInput): SizePositionResult {
  const balance = dec(input.balanceBasis);
  const riskPercent = dec(input.riskPercent);
  const entry = dec(input.entry);
  const stop = dec(input.initialStop);
  const value = dec(input.accountValuePerPriceUnit);
  const { quantityStep, minQuantity, maxQuantity } = input.spec;

  if (!balance.greaterThan(0)) return { status: "INVALID", reason: "Balance basis must be greater than zero." };
  if (!riskPercent.greaterThan(0)) return { status: "INVALID", reason: "Risk % must be greater than zero." };
  if (!entry.greaterThan(0) || !stop.greaterThan(0)) return { status: "INVALID", reason: "Entry and initial stop must be positive prices." };
  if (!value.greaterThan(0)) return { status: "INVALID", reason: "Value per price unit must be greater than zero." };

  const stopDistance = input.direction === "LONG" ? entry.minus(stop) : stop.minus(entry);
  if (!stopDistance.greaterThan(0)) {
    return { status: "INVALID", reason: `Initial stop must be ${input.direction === "LONG" ? "below" : "above"} entry for a ${input.direction} position.` };
  }

  const intendedRiskAmount = floorMoney(balance.times(riskPercent).dividedBy(100), input.moneyScale === undefined ? DEFAULT_MONEY_SCALE : input.moneyScale);
  if (!intendedRiskAmount.greaterThan(0)) return { status: "INVALID", reason: "Intended risk rounds to zero." };

  const lossPerQuantityUnit = stopDistance.times(value);
  const rawQuantity = intendedRiskAmount.dividedBy(lossPerQuantityUnit);
  let executableQuantity = quantizeDown(rawQuantity, quantityStep);
  let cappedAtMax = false;
  if (maxQuantity && executableQuantity.greaterThan(maxQuantity)) {
    executableQuantity = maxQuantity;
    cappedAtMax = true;
  }

  if (executableQuantity.lessThan(minQuantity)) {
    return {
      status: "CANNOT_SIZE_WITHIN_RISK",
      reason: "BELOW_MIN_QUANTITY",
      intendedRiskAmount,
      lossPerQuantityUnit,
      rawQuantity,
      minQuantity,
      riskAtMinQuantity: minQuantity.times(lossPerQuantityUnit),
    };
  }

  const effectiveRiskAmount = executableQuantity.times(lossPerQuantityUnit);
  return {
    status: "SIZED",
    intendedRiskAmount,
    stopDistance,
    lossPerQuantityUnit,
    rawQuantity,
    executableQuantity,
    effectiveRiskAmount,
    riskShortfall: intendedRiskAmount.minus(effectiveRiskAmount),
    cappedAtMax,
  };
}
