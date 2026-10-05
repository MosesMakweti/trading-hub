/**
 * Quantity-ledger execution engine (Phase 1) — percent-of-remaining close.
 * Pure.
 *
 * A percentage is an interaction convenience; the canonical fact it produces
 * is a QUANTITY. "Close 50%" means 50% of the CURRENT REMAINING quantity
 * (never of the original), quantized DOWN to quantityStep — a close never
 * exceeds what was asked for.
 *
 * Final-residual absorption: if the close would leave a remainder that is
 * positive but below minQuantity (a position the account could not hold or
 * close on its own), the remainder is absorbed into this close and the
 * position closes fully. 100% always closes exactly the remaining quantity.
 * Every result is an exact multiple of quantityStep, so the final close
 * leaves exactly zero — no floating-point dust.
 */
import type { Decimal } from "decimal.js";
import { dec, isMultipleOf, quantizeDown, type DecimalInput } from "./precision";

export interface PercentCloseInput {
  remainingQuantity: DecimalInput;
  percentOfRemaining: DecimalInput;
  quantityStep: DecimalInput;
  minQuantity: DecimalInput;
  /** Default true. */
  absorbResidualBelowMin?: boolean;
}

export type PercentCloseResult =
  | {
      status: "OK";
      closeQuantity: Decimal;
      remainingAfter: Decimal;
      /** Quantity added to the requested close by residual absorption (0 when none). */
      absorbedResidual: Decimal;
      /** The un-quantized request: remaining × percent / 100. */
      requestedQuantity: Decimal;
      closesPosition: boolean;
    }
  | { status: "BELOW_STEP"; requestedQuantity: Decimal; quantityStep: Decimal; reason: string }
  | { status: "BELOW_MIN_QUANTITY"; requestedQuantity: Decimal; closeQuantity: Decimal; minQuantity: Decimal; reason: string }
  | { status: "INVALID"; reason: string };

export function quantityForPercentOfRemaining(input: PercentCloseInput): PercentCloseResult {
  const remaining = dec(input.remainingQuantity);
  const percent = dec(input.percentOfRemaining);
  const step = dec(input.quantityStep);
  const min = dec(input.minQuantity);

  if (!step.greaterThan(0)) return { status: "INVALID", reason: "quantityStep must be greater than zero." };
  if (!remaining.greaterThan(0)) return { status: "INVALID", reason: "Nothing remains open." };
  if (!isMultipleOf(remaining, step)) return { status: "INVALID", reason: "Remaining quantity is not a multiple of quantityStep." };
  if (!percent.greaterThan(0) || percent.greaterThan(100)) return { status: "INVALID", reason: "Percent must be greater than 0 and at most 100." };

  const requestedQuantity = remaining.times(percent).dividedBy(100);
  if (percent.equals(100)) {
    return { status: "OK", closeQuantity: remaining, remainingAfter: dec(0), absorbedResidual: dec(0), requestedQuantity, closesPosition: true };
  }

  let closeQuantity = quantizeDown(requestedQuantity, step);
  if (closeQuantity.isZero()) {
    return {
      status: "BELOW_STEP",
      requestedQuantity,
      quantityStep: step,
      reason: `${percent.toString()}% of ${remaining.toString()} is below the smallest tradable step (${step.toString()}).`,
    };
  }

  let absorbedResidual = dec(0);
  const leftover = remaining.minus(closeQuantity);
  if ((input.absorbResidualBelowMin ?? true) && leftover.greaterThan(0) && leftover.lessThan(min)) {
    absorbedResidual = leftover;
    closeQuantity = remaining;
  }

  if (closeQuantity.lessThan(min)) {
    return {
      status: "BELOW_MIN_QUANTITY",
      requestedQuantity,
      closeQuantity,
      minQuantity: min,
      reason: `Closing ${closeQuantity.toString()} is below the minimum tradable quantity (${min.toString()}).`,
    };
  }

  const remainingAfter = remaining.minus(closeQuantity);
  return { status: "OK", closeQuantity, remainingAfter, absorbedResidual, requestedQuantity, closesPosition: remainingAfter.isZero() };
}
