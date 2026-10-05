/**
 * Quantity-ledger execution engine (Phase 1) — precision primitives. Pure.
 *
 * Every financial quantity in src/domain/execution is a Decimal from the
 * isolated `ExecDecimal` constructor below (40 significant digits, its own
 * config — the global decimal.js config other modules rely on is never
 * touched). JS numbers are accepted at the boundary only and are converted
 * through their shortest decimal string (0.1 → "0.1"); no arithmetic ever
 * happens in binary floating point.
 *
 * ROUNDING POLICY (deterministic, documented in docs/EXECUTION_ENGINE.md):
 *   • Quantities are never rounded to "nice" values — they are QUANTIZED
 *     DOWN to an exact multiple of the instrument's quantityStep (sizing and
 *     percent-of-remaining closes never exceed what was asked for).
 *   • Intended risk (a budget) is rounded DOWN to the money scale, so the
 *     budget can never exceed balance × risk%.
 *   • Booked realized PnL is rounded per fill, HALF-EVEN, to the money scale
 *     (a fill is what an account books); cumulative realized PnL is the exact
 *     sum of those booked fill amounts, so Σ fill PnL = realized PnL exactly.
 *   • Effective risk, unrealized PnL and every R value are left unrounded
 *     (derived measures); presentation rounds them with `roundMoney` /
 *     `roundR`.
 *   • `moneyScale: null` disables money rounding entirely (exact math — used
 *     by the legacy-R comparison).
 */
import { Decimal } from "decimal.js";

export const ExecDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});

/** What the engine accepts at its boundary. */
export type DecimalInput = Decimal.Value;

/** Account-currency minor units used when the caller doesn't say otherwise (USD-first). */
export const DEFAULT_MONEY_SCALE = 2;

export function dec(value: DecimalInput): Decimal {
  const d = new ExecDecimal(value);
  if (!d.isFinite()) throw new RangeError(`Not a finite decimal: ${String(value)}`);
  return d;
}

export const ZERO = new ExecDecimal(0);

/** Largest exact multiple of `step` that is ≤ `value` (value, step > 0). */
export function quantizeDown(value: Decimal, step: Decimal): Decimal {
  if (!step.greaterThan(0)) throw new RangeError("quantityStep must be greater than zero.");
  if (value.lessThanOrEqualTo(0)) return ZERO;
  return value.dividedToIntegerBy(step).times(step);
}

export function isMultipleOf(value: Decimal, step: Decimal): boolean {
  return value.mod(step).isZero();
}

/** Booked money: HALF-EVEN to `scale` decimals; `null` = exact. */
export function roundMoney(value: Decimal, scale: number | null = DEFAULT_MONEY_SCALE): Decimal {
  return scale == null ? value : value.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
}

/** Budgets: DOWN to `scale` decimals (never exceeds the exact budget); `null` = exact. */
export function floorMoney(value: Decimal, scale: number | null = DEFAULT_MONEY_SCALE): Decimal {
  return scale == null ? value : value.toDecimalPlaces(scale, Decimal.ROUND_DOWN);
}

/** Presentation only — the engine never stores a rounded R. */
export function roundR(value: Decimal, places = 2): Decimal {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN);
}
