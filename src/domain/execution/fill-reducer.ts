/**
 * Quantity-ledger execution engine (Phase 1) — closing-fill reducer. Pure.
 *
 *   Quantity + actual price movement determine PnL.
 *   Realized PnL / frozen intended risk determines realized R.
 *
 *   priceDelta   LONG = exit − entry      SHORT = entry − exit
 *   fillPnl      = priceDelta × executedQuantity × accountValuePerPriceUnit
 *                  (booked: HALF-EVEN to moneyScale)
 *   realizedPnl  = Σ fillPnl                       (exact sum of booked fills)
 *   realizedR    = realizedPnl / intendedRiskAmount (the frozen INTENDED risk,
 *                  never the effective risk — a full stop-out at a rounded
 *                  quantity is e.g. −0.996R, deliberately not normalized)
 *
 * Invariants (checked; any violation returns INVALID naming the fill):
 *   initialQuantity > 0 and a multiple of quantityStep
 *   every executed quantity > 0, a multiple of quantityStep, ≤ remainingBefore
 *   remainingAfter = remainingBefore − executed ≥ 0
 *   Σ closed + remaining = initialQuantity
 *   fullyClosed ⇔ remaining = 0
 *
 * Fills are taken in the given order (the caller orders the ledger). Phase 1
 * handles closing fills only; reversal/correction fills are a Phase 2 ledger
 * concern.
 */
import type { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";
import { DEFAULT_MONEY_SCALE, dec, isMultipleOf, roundMoney, ZERO, type DecimalInput } from "./precision";

export interface ClosingFill {
  id?: string;
  quantity: DecimalInput;
  price: DecimalInput;
}

export interface ReducePositionInput {
  direction: DirectionLike;
  entry: DecimalInput;
  initialQuantity: DecimalInput;
  /** The frozen intended (budget) risk — the R denominator. */
  intendedRiskAmount: DecimalInput;
  accountValuePerPriceUnit: DecimalInput;
  quantityStep: DecimalInput;
  fills: ClosingFill[];
  /** When given, unrealized PnL/R are computed on the remaining quantity. */
  markPrice?: DecimalInput | null;
  /** Account-currency minor units for booked fill PnL; null = exact. */
  moneyScale?: number | null;
}

export interface FillResult {
  index: number;
  id?: string;
  price: Decimal;
  quantityBefore: Decimal;
  executedQuantity: Decimal;
  quantityAfter: Decimal;
  priceDelta: Decimal;
  realizedPnl: Decimal;
  realizedR: Decimal;
  cumulativeRealizedPnl: Decimal;
  cumulativeRealizedR: Decimal;
}

export type ReducePositionResult =
  | {
      status: "OK";
      initialQuantity: Decimal;
      intendedRiskAmount: Decimal;
      fills: FillResult[];
      closedQuantity: Decimal;
      remainingQuantity: Decimal;
      fullyClosed: boolean;
      realizedPnl: Decimal;
      realizedR: Decimal;
      /** Quantity-weighted average exit; null before any fill. */
      weightedAverageExit: Decimal | null;
      /** Null when no mark price was given. Zero when fully closed. */
      unrealizedPnl: Decimal | null;
      unrealizedR: Decimal | null;
    }
  | { status: "INVALID"; fillIndex: number | null; reason: string };

export function priceDeltaFor(direction: DirectionLike, entry: Decimal, exit: Decimal): Decimal {
  return direction === "LONG" ? exit.minus(entry) : entry.minus(exit);
}

export function reducePosition(input: ReducePositionInput): ReducePositionResult {
  const entry = dec(input.entry);
  const initialQuantity = dec(input.initialQuantity);
  const intendedRiskAmount = dec(input.intendedRiskAmount);
  const value = dec(input.accountValuePerPriceUnit);
  const step = dec(input.quantityStep);
  const moneyScale = input.moneyScale === undefined ? DEFAULT_MONEY_SCALE : input.moneyScale;

  if (!entry.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "Entry must be a positive price." };
  if (!step.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "quantityStep must be greater than zero." };
  if (!initialQuantity.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "Initial quantity must be greater than zero." };
  if (!isMultipleOf(initialQuantity, step)) return { status: "INVALID", fillIndex: null, reason: "Initial quantity must be a multiple of quantityStep." };
  if (!intendedRiskAmount.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "Intended risk amount must be greater than zero." };
  if (!value.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "Value per price unit must be greater than zero." };

  let remaining = initialQuantity;
  let closed = ZERO;
  let realizedPnl = ZERO;
  let exitNotional = ZERO; // Σ price × quantity, for the weighted average exit
  const results: FillResult[] = [];

  for (let index = 0; index < input.fills.length; index++) {
    const fill = input.fills[index];
    const price = dec(fill.price);
    const quantity = dec(fill.quantity);
    if (!price.greaterThan(0)) return { status: "INVALID", fillIndex: index, reason: "Fill price must be positive." };
    if (!quantity.greaterThan(0)) return { status: "INVALID", fillIndex: index, reason: "Executed close quantity must be greater than zero." };
    if (!isMultipleOf(quantity, step)) return { status: "INVALID", fillIndex: index, reason: "Executed close quantity must be a multiple of quantityStep." };
    if (quantity.greaterThan(remaining)) {
      return {
        status: "INVALID",
        fillIndex: index,
        reason: `Fill closes ${quantity.toString()} but only ${remaining.toString()} remains — a fill can never create negative remaining quantity.`,
      };
    }

    const quantityBefore = remaining;
    const quantityAfter = quantityBefore.minus(quantity);
    const priceDelta = priceDeltaFor(input.direction, entry, price);
    const fillPnl = roundMoney(priceDelta.times(quantity).times(value), moneyScale);

    remaining = quantityAfter;
    closed = closed.plus(quantity);
    realizedPnl = realizedPnl.plus(fillPnl);
    exitNotional = exitNotional.plus(price.times(quantity));

    results.push({
      index,
      id: fill.id,
      price,
      quantityBefore,
      executedQuantity: quantity,
      quantityAfter,
      priceDelta,
      realizedPnl: fillPnl,
      realizedR: fillPnl.dividedBy(intendedRiskAmount),
      cumulativeRealizedPnl: realizedPnl,
      cumulativeRealizedR: realizedPnl.dividedBy(intendedRiskAmount),
    });
  }

  // Conservation — holds by construction; asserted so a future edit can't silently break it.
  if (!closed.plus(remaining).equals(initialQuantity) || remaining.isNegative()) {
    return { status: "INVALID", fillIndex: null, reason: "Quantity conservation violated." };
  }

  let unrealizedPnl: Decimal | null = null;
  if (input.markPrice != null) {
    const mark = dec(input.markPrice);
    if (!mark.greaterThan(0)) return { status: "INVALID", fillIndex: null, reason: "Mark price must be positive." };
    unrealizedPnl = priceDeltaFor(input.direction, entry, mark).times(remaining).times(value);
  }

  return {
    status: "OK",
    initialQuantity,
    intendedRiskAmount,
    fills: results,
    closedQuantity: closed,
    remainingQuantity: remaining,
    fullyClosed: remaining.isZero(),
    realizedPnl,
    realizedR: realizedPnl.dividedBy(intendedRiskAmount),
    weightedAverageExit: closed.isZero() ? null : exitNotional.dividedBy(closed),
    unrealizedPnl,
    unrealizedR: unrealizedPnl == null ? null : unrealizedPnl.dividedBy(intendedRiskAmount),
  };
}
