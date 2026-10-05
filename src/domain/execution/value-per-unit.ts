/**
 * Quantity-ledger execution engine (Phase 1) — instrument economics. Pure.
 *
 * The single conversion from price movement to money:
 *
 *   accountValuePerPriceUnit
 *     = account-currency value of a 1.0 PRICE move for 1 unit of quantity
 *     = quoteValuePerPriceUnit × conversionRate(quote → account)
 *
 *   quoteValuePerPriceUnit
 *     CONTRACT_SIZE (FX, metals, CFDs): contractSize
 *     TICK_VALUE    (futures):          tickValue / tickSize
 *
 * No "pip × $10" shortcut: EURUSD's $10/pip/lot is DERIVED here
 * (0.0001 × 100000 = 10 USD). Pips/points/ticks are presentation only
 * (`describeDistance`).
 *
 * Currency-neutral: same currency → rate 1 (identity, not an assumption);
 * different currency → the caller must supply an explicit rate, otherwise
 * CONVERSION_REQUIRED. There is no FX lookup and no 1:1 fallback.
 */
import type { Decimal } from "decimal.js";
import type { ResolvedExecutionSpec } from "./instrument-spec";
import { dec, type DecimalInput } from "./precision";

export interface ConversionRate {
  /** ISO currency of the instrument's quote (the value being converted). */
  from: string;
  /** Account currency. */
  to: string;
  /** Units of `to` per 1 unit of `from`. */
  rate: DecimalInput;
}

export type ValuePerUnitResult =
  | {
      status: "OK";
      accountCurrency: string;
      quoteCurrency: string;
      quoteValuePerPriceUnit: Decimal;
      conversionRate: Decimal;
      /** Account-currency value of a 1.0 price move per 1 quantity unit. */
      accountValuePerPriceUnit: Decimal;
    }
  | { status: "CONVERSION_REQUIRED"; from: string; to: string; reason: string };

export function quoteValuePerPriceUnit(spec: ResolvedExecutionSpec): Decimal {
  if (spec.pricingModel === "TICK_VALUE") {
    // resolveExecutionSpec guarantees both are present and positive for this model.
    return spec.tickValue!.dividedBy(spec.tickSize!);
  }
  return spec.contractSize!;
}

export function computeValuePerPriceUnit(
  spec: ResolvedExecutionSpec,
  accountCurrency: string,
  conversion?: ConversionRate | null,
): ValuePerUnitResult {
  const quote = spec.quoteCurrency.toUpperCase();
  const account = accountCurrency.trim().toUpperCase();
  const quoteValue = quoteValuePerPriceUnit(spec);

  if (quote === account) {
    return { status: "OK", accountCurrency: account, quoteCurrency: quote, quoteValuePerPriceUnit: quoteValue, conversionRate: dec(1), accountValuePerPriceUnit: quoteValue };
  }
  if (!conversion) {
    return { status: "CONVERSION_REQUIRED", from: quote, to: account, reason: `A ${quote}→${account} rate is required; none was supplied.` };
  }
  if (conversion.from.toUpperCase() !== quote || conversion.to.toUpperCase() !== account) {
    return {
      status: "CONVERSION_REQUIRED",
      from: quote,
      to: account,
      reason: `Supplied rate is ${conversion.from}→${conversion.to}; ${quote}→${account} is required.`,
    };
  }
  const rate = dec(conversion.rate);
  if (!rate.greaterThan(0)) {
    return { status: "CONVERSION_REQUIRED", from: quote, to: account, reason: "Conversion rate must be greater than zero." };
  }
  return {
    status: "OK",
    accountCurrency: account,
    quoteCurrency: quote,
    quoteValuePerPriceUnit: quoteValue,
    conversionRate: rate,
    accountValuePerPriceUnit: quoteValue.times(rate),
  };
}

/** Presentation of a price distance in the instrument's own units. Never feeds money math. */
export function describeDistance(spec: ResolvedExecutionSpec, priceDistance: DecimalInput) {
  const d = dec(priceDistance).abs();
  return {
    price: d,
    pips: spec.pipSize ? d.dividedBy(spec.pipSize) : null,
    points: spec.pointSize ? d.dividedBy(spec.pointSize) : null,
    ticks: spec.tickSize ? d.dividedBy(spec.tickSize) : null,
  };
}
