/**
 * Quantity ledger (Phase 2) — deterministic replay of an append-only fill
 * ledger, and planning of the next CLOSE / REVERSAL fill. Pure.
 *
 * Settlement is reproducible solely from the frozen snapshot + the fills in
 * `sequence` order (executedAt never orders anything):
 *
 *   CLOSE     remaining −= qty; grossPnl = round(Δprice × qty × quoteValue × rate)
 *   REVERSAL  remaining += target qty; grossPnl/fees = −target's (exact negation)
 *   net       = gross − fees (fees null ⇒ 0)
 *   realizedPnl = Σ net        realizedR = realizedPnl / riskAmount (intended)
 *
 * A reversed CLOSE and its REVERSAL cancel; the "effective" closes (CLOSE
 * fills not reversed) are what the weighted average exit and the reader
 * projection use. Every stored per-fill fact that the replay can re-derive
 * (quantityBefore/After, booked grossPnl) is verified; a mismatch is
 * LEDGER_CORRUPT, never silently trusted.
 */
import type { Decimal } from "decimal.js";
import type { DirectionLike } from "@/domain/prop-firms/risk";
import { priceDeltaFor } from "./fill-reducer";
import { quantityForPercentOfRemaining } from "./partial-close";
import { DEFAULT_MONEY_SCALE, dec, isMultipleOf, roundMoney, ZERO, type DecimalInput } from "./precision";

export type LedgerFillKind = "CLOSE" | "REVERSAL";

export interface LedgerFill {
  id: string;
  sequence: number;
  kind: LedgerFillKind;
  executedQuantity: DecimalInput;
  price: DecimalInput;
  quantityBefore: DecimalInput;
  quantityAfter: DecimalInput;
  grossPnl: DecimalInput;
  fees: DecimalInput | null;
  conversionRate: DecimalInput;
  reversesFillId: string | null;
  executedAt: Date;
}

export interface LedgerTerms {
  direction: DirectionLike;
  entry: DecimalInput;
  /** Frozen executable quantity. */
  initialQuantity: DecimalInput;
  /** Frozen intended risk budget — the realized-R denominator. */
  riskAmount: DecimalInput;
  /** From the frozen spec snapshot (quote currency, per 1.0 price, per unit). */
  quoteValuePerPriceUnit: DecimalInput;
  quantityStep: DecimalInput;
  minQuantity: DecimalInput;
  moneyScale?: number | null;
}

export interface ReplayedFill {
  id: string;
  sequence: number;
  kind: LedgerFillKind;
  executedQuantity: Decimal;
  price: Decimal;
  quantityBefore: Decimal;
  quantityAfter: Decimal;
  grossPnl: Decimal;
  netPnl: Decimal;
  realizedR: Decimal;
  cumulativeRealizedPnl: Decimal;
  cumulativeRealizedR: Decimal;
  reversesFillId: string | null;
  reversed: boolean;
  executedAt: Date;
}

export interface LedgerState {
  initialQuantity: Decimal;
  riskAmount: Decimal;
  fills: ReplayedFill[];
  remainingQuantity: Decimal;
  closedQuantity: Decimal;
  fullyClosed: boolean;
  realizedPnl: Decimal;
  realizedR: Decimal;
  weightedAverageExit: Decimal | null;
  /** CLOSE fills that have not been reversed, in sequence order. */
  effectiveCloses: ReplayedFill[];
}

export type LedgerErrorCode =
  | "LEDGER_CORRUPT"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INVALID_CONVERSION_RATE"
  | "EXCEEDS_REMAINING"
  | "POSITION_CLOSED"
  | "BELOW_STEP"
  | "BELOW_MIN_QUANTITY"
  | "REVERSAL_TARGET_NOT_FOUND"
  | "REVERSAL_TARGET_NOT_CLOSE"
  | "REVERSAL_ALREADY_REVERSED";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

function terms(t: LedgerTerms) {
  return {
    direction: t.direction,
    entry: dec(t.entry),
    initialQuantity: dec(t.initialQuantity),
    riskAmount: dec(t.riskAmount),
    quoteValue: dec(t.quoteValuePerPriceUnit),
    step: dec(t.quantityStep),
    min: dec(t.minQuantity),
    moneyScale: t.moneyScale === undefined ? DEFAULT_MONEY_SCALE : t.moneyScale,
  };
}

/** Booked gross PnL of a close: Δprice × qty × quoteValue × rate, HALF-EVEN to cents. */
export function bookCloseGross(t: LedgerTerms, quantity: DecimalInput, price: DecimalInput, conversionRate: DecimalInput): Decimal {
  const k = terms(t);
  return roundMoney(priceDeltaFor(k.direction, k.entry, dec(price)).times(quantity).times(k.quoteValue).times(conversionRate), k.moneyScale);
}

const corrupt = (fill: { sequence: number }, why: string) => new LedgerError("LEDGER_CORRUPT", `Fill #${fill.sequence}: ${why}`);

/** Replays the ledger in sequence order, verifying every invariant. Throws LedgerError("LEDGER_CORRUPT") on any inconsistency. */
export function replayLedger(t: LedgerTerms, fills: LedgerFill[]): LedgerState {
  const k = terms(t);
  if (!k.initialQuantity.greaterThan(0) || !isMultipleOf(k.initialQuantity, k.step)) {
    throw new LedgerError("LEDGER_CORRUPT", "Frozen initial quantity is not a positive multiple of the step.");
  }
  if (!k.riskAmount.greaterThan(0)) throw new LedgerError("LEDGER_CORRUPT", "Frozen risk amount must be positive.");

  const ordered = [...fills].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map<string, ReplayedFill>();
  const replayed: ReplayedFill[] = [];
  let remaining = k.initialQuantity;
  let realized = ZERO;

  ordered.forEach((f, i) => {
    if (f.sequence !== i + 1) throw corrupt(f, `sequence gap (expected ${i + 1}).`);
    const qty = dec(f.executedQuantity);
    const price = dec(f.price);
    const rate = dec(f.conversionRate);
    const gross = dec(f.grossPnl);
    const fees = f.fees == null ? null : dec(f.fees);
    if (!qty.greaterThan(0) || !isMultipleOf(qty, k.step)) throw corrupt(f, "quantity is not a positive step multiple.");
    if (!dec(f.quantityBefore).equals(remaining)) throw corrupt(f, "quantityBefore does not match the replay.");

    let after: Decimal;
    if (f.kind === "CLOSE") {
      if (f.reversesFillId != null) throw corrupt(f, "a CLOSE cannot reverse a fill.");
      if (qty.greaterThan(remaining)) throw corrupt(f, "closes more than remained.");
      if (!gross.equals(bookCloseGross(t, qty, price, rate))) throw corrupt(f, "booked gross PnL does not match the frozen economics.");
      after = remaining.minus(qty);
    } else {
      const target = f.reversesFillId ? byId.get(f.reversesFillId) : undefined;
      if (!target) throw corrupt(f, "reversal target is not an earlier fill of this ledger.");
      if (target.kind !== "CLOSE") throw corrupt(f, "only a CLOSE can be reversed.");
      if (target.reversed) throw corrupt(f, "target already reversed.");
      const targetSrc = ordered[target.sequence - 1];
      const targetFees = targetSrc.fees == null ? null : dec(targetSrc.fees);
      if (
        !qty.equals(target.executedQuantity) ||
        !price.equals(target.price) ||
        !rate.equals(dec(targetSrc.conversionRate)) ||
        !gross.equals(target.grossPnl.negated()) ||
        (targetFees == null ? fees != null : fees == null || !fees.equals(targetFees.negated()))
      ) {
        throw corrupt(f, "reversal does not exactly negate its target.");
      }
      target.reversed = true;
      after = remaining.plus(qty);
      if (after.greaterThan(k.initialQuantity)) throw corrupt(f, "reversal exceeds the initial quantity.");
    }
    if (!dec(f.quantityAfter).equals(after)) throw corrupt(f, "quantityAfter does not match the replay.");

    const net = fees == null ? gross : gross.minus(fees);
    realized = realized.plus(net);
    const row: ReplayedFill = {
      id: f.id,
      sequence: f.sequence,
      kind: f.kind,
      executedQuantity: qty,
      price,
      quantityBefore: remaining,
      quantityAfter: after,
      grossPnl: gross,
      netPnl: net,
      realizedR: net.dividedBy(k.riskAmount),
      cumulativeRealizedPnl: realized,
      cumulativeRealizedR: realized.dividedBy(k.riskAmount),
      reversesFillId: f.reversesFillId,
      reversed: false,
      executedAt: f.executedAt,
    };
    byId.set(f.id, row);
    replayed.push(row);
    remaining = after;
  });

  const effectiveCloses = replayed.filter((r) => r.kind === "CLOSE" && !r.reversed);
  const closedQuantity = effectiveCloses.reduce((sum, r) => sum.plus(r.executedQuantity), ZERO);
  if (!closedQuantity.plus(remaining).equals(k.initialQuantity)) {
    throw new LedgerError("LEDGER_CORRUPT", "Quantity conservation violated.");
  }
  const notional = effectiveCloses.reduce((sum, r) => sum.plus(r.price.times(r.executedQuantity)), ZERO);

  return {
    initialQuantity: k.initialQuantity,
    riskAmount: k.riskAmount,
    fills: replayed,
    remainingQuantity: remaining,
    closedQuantity,
    fullyClosed: remaining.isZero(),
    realizedPnl: realized,
    realizedR: realized.dividedBy(k.riskAmount),
    weightedAverageExit: closedQuantity.isZero() ? null : notional.dividedBy(closedQuantity),
    effectiveCloses,
  };
}

export interface PlannedFill {
  kind: LedgerFillKind;
  executedQuantity: Decimal;
  price: Decimal;
  quantityBefore: Decimal;
  quantityAfter: Decimal;
  grossPnl: Decimal;
  fees: Decimal | null;
  conversionRate: Decimal;
  reversesFillId: string | null;
  requestedQuantity: Decimal | null;
  requestedPercent: Decimal | null;
}

export type CloseRequest =
  | { quantity: DecimalInput; percentOfRemaining?: never }
  | { percentOfRemaining: DecimalInput; quantity?: never };

/** The next CLOSE fill for `request` against the current ledger state. Throws LedgerError. */
export function planCloseFill(t: LedgerTerms, state: LedgerState, request: CloseRequest, price: DecimalInput, conversionRate: DecimalInput): PlannedFill {
  const k = terms(t);
  const p = dec(price);
  const rate = dec(conversionRate);
  if (!p.greaterThan(0)) throw new LedgerError("INVALID_PRICE", "Fill price must be positive.");
  if (!rate.greaterThan(0)) throw new LedgerError("INVALID_CONVERSION_RATE", "Conversion rate must be positive.");
  if (state.remainingQuantity.isZero()) throw new LedgerError("POSITION_CLOSED", "The position is already fully closed.");

  let quantity: Decimal;
  let requestedQuantity: Decimal | null = null;
  let requestedPercent: Decimal | null = null;
  if (request.percentOfRemaining != null) {
    requestedPercent = dec(request.percentOfRemaining);
    const c = quantityForPercentOfRemaining({
      remainingQuantity: state.remainingQuantity,
      percentOfRemaining: requestedPercent,
      quantityStep: k.step,
      minQuantity: k.min,
    });
    if (c.status === "BELOW_STEP") throw new LedgerError("BELOW_STEP", c.reason);
    if (c.status === "BELOW_MIN_QUANTITY") throw new LedgerError("BELOW_MIN_QUANTITY", c.reason);
    if (c.status === "INVALID") throw new LedgerError("INVALID_QUANTITY", c.reason);
    quantity = c.closeQuantity;
  } else {
    requestedQuantity = dec(request.quantity);
    quantity = requestedQuantity;
    if (!quantity.greaterThan(0) || !isMultipleOf(quantity, k.step)) {
      throw new LedgerError("INVALID_QUANTITY", `Quantity must be a positive multiple of ${k.step.toString()}.`);
    }
    if (quantity.greaterThan(state.remainingQuantity)) {
      throw new LedgerError("EXCEEDS_REMAINING", `Closing ${quantity.toString()} exceeds the remaining ${state.remainingQuantity.toString()}.`);
    }
    const leftover = state.remainingQuantity.minus(quantity);
    if (quantity.lessThan(k.min) && !leftover.isZero()) {
      throw new LedgerError("BELOW_MIN_QUANTITY", `Closing ${quantity.toString()} is below the minimum (${k.min.toString()}).`);
    }
  }

  return {
    kind: "CLOSE",
    executedQuantity: quantity,
    price: p,
    quantityBefore: state.remainingQuantity,
    quantityAfter: state.remainingQuantity.minus(quantity),
    grossPnl: bookCloseGross(t, quantity, p, rate),
    fees: null,
    conversionRate: rate,
    reversesFillId: null,
    requestedQuantity,
    requestedPercent,
  };
}

/** The REVERSAL of `targetFillId`: an exact negation of an unreversed CLOSE of THIS ledger. Throws LedgerError. */
export function planReversal(state: LedgerState, source: LedgerFill[], targetFillId: string): PlannedFill {
  const target = state.fills.find((f) => f.id === targetFillId);
  if (!target) throw new LedgerError("REVERSAL_TARGET_NOT_FOUND", "The fill to reverse is not part of this ledger.");
  if (target.kind !== "CLOSE") throw new LedgerError("REVERSAL_TARGET_NOT_CLOSE", "Only a CLOSE fill can be reversed.");
  if (target.reversed) throw new LedgerError("REVERSAL_ALREADY_REVERSED", "This fill has already been reversed.");
  const src = source.find((f) => f.id === targetFillId)!;
  const fees = src.fees == null ? null : dec(src.fees).negated();
  return {
    kind: "REVERSAL",
    executedQuantity: target.executedQuantity,
    price: target.price,
    quantityBefore: state.remainingQuantity,
    quantityAfter: state.remainingQuantity.plus(target.executedQuantity),
    grossPnl: target.grossPnl.negated(),
    fees,
    conversionRate: dec(src.conversionRate),
    reversesFillId: target.id,
    requestedQuantity: null,
    requestedPercent: null,
  };
}
