/**
 * Simulated money — Decimal-exact, built on domain/execution's precision
 * helpers (40 significant digits, HALF_EVEN money rounding).
 *
 *   price           = points / 10^priceScale            (exact)
 *   gross PnL       = roundMoney(priceDelta × quantity × accountValuePerPriceUnit)
 *   commission      = −roundMoney(commissionPerUnitPerSide × quantity)   per side
 *   swap            = roundMoney(swapPerUnit × quantity)                 per night
 *   R               = realized PnL / intended risk (the frozen budget, never re-normalised)
 *
 * Currency conversion (decision D8) uses only replay prices at the fill
 * minute — never an external rate and never 1:1 by default:
 *   quote = account                    → 1
 *   symbol = ACCOUNT+QUOTE (USDJPY)    → 1 / price(USDJPY)
 *   QUOTE+ACCOUNT pinned (GBPUSD)      → price(GBPUSD)
 *   ACCOUNT+QUOTE pinned (USDJPY)      → 1 / price(USDJPY)
 *   otherwise                          → CONVERSION_REQUIRED (the order is refused)
 */
import type { Decimal } from "decimal.js";

import { dec, roundMoney, ZERO, type DecimalInput } from "@/domain/execution/precision";

export function pointsToPrice(points: number, priceScale: number): Decimal {
  return dec(points).dividedBy(dec(10).pow(priceScale));
}

/**
 * A trader-typed price → integer points at the dataset's scale. Refuses a
 * price with more decimals than the dataset has (it couldn't be filled).
 */
export function priceToPoints(price: DecimalInput, priceScale: number): number | null {
  const scaled = dec(price).times(dec(10).pow(priceScale));
  if (!scaled.isInteger() || !scaled.isPositive() || scaled.greaterThan(2_147_483_647)) return null;
  return scaled.toNumber();
}

export function priceDelta(side: "BUY" | "SELL", entry: Decimal, exit: Decimal): Decimal {
  return side === "BUY" ? exit.minus(entry) : entry.minus(exit);
}

export function grossPnl(input: { side: "BUY" | "SELL"; entry: Decimal; exit: Decimal; quantity: DecimalInput; valuePerPriceUnit: DecimalInput }): Decimal {
  return roundMoney(priceDelta(input.side, input.entry, input.exit).times(dec(input.quantity)).times(dec(input.valuePerPriceUnit)));
}

/** Commission for one side of a fill, as a signed ledger amount (≤ 0). */
export function commissionFor(quantity: DecimalInput, perUnitPerSide: DecimalInput): Decimal {
  const amount = roundMoney(dec(perUnitPerSide).times(dec(quantity)));
  return amount.isZero() ? ZERO : amount.negated();
}

/** Swap for one night held, as a signed ledger amount. */
export function swapFor(quantity: DecimalInput, perUnit: DecimalInput): Decimal {
  return roundMoney(dec(perUnit).times(dec(quantity)));
}

export function rMultiple(pnl: DecimalInput, intendedRisk: DecimalInput | null): Decimal | null {
  if (intendedRisk == null) return null;
  const risk = dec(intendedRisk);
  return risk.isZero() ? null : dec(pnl).dividedBy(risk);
}

export type ConversionResult =
  | { status: "OK"; rate: Decimal; via: string | null }
  | { status: "CONVERSION_REQUIRED"; reason: string };

/**
 * Units of account currency per 1 unit of quote currency at this minute.
 * `priceOf(symbol)` returns a pinned instrument's current bid (Decimal) or
 * null when that symbol isn't available to the account.
 */
export function resolveConversion(input: {
  symbol: string;
  quoteCurrency: string;
  accountCurrency: string;
  priceOf: (symbol: string) => Decimal | null;
}): ConversionResult {
  const quote = input.quoteCurrency.toUpperCase();
  const account = input.accountCurrency.toUpperCase();
  if (quote === account) return { status: "OK", rate: dec(1), via: null };

  const inverse = (symbol: string): ConversionResult | null => {
    const p = input.priceOf(symbol);
    return p && p.isPositive() ? { status: "OK", rate: dec(1).dividedBy(p), via: symbol } : null;
  };
  const direct = (symbol: string): ConversionResult | null => {
    const p = input.priceOf(symbol);
    return p && p.isPositive() ? { status: "OK", rate: p, via: symbol } : null;
  };

  return (
    inverse(`${account}${quote}`) ??
    direct(`${quote}${account}`) ?? {
      status: "CONVERSION_REQUIRED",
      reason: `Converting ${quote} to ${account} needs ${quote}${account} or ${account}${quote} price data on this account.`,
    }
  );
}
