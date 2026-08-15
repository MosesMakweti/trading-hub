/**
 * Instrument-aware position sizing (spec §3). Never guesses a size when the
 * required instrument data is missing — returns a discriminated union so the
 * caller (trade-executions.service.ts / the Account Allocation UI) can show
 * exactly what's still needed instead of a wrong number.
 */
import { Decimal } from "decimal.js";

export type PositionSizeUnit = "LOTS" | "CONTRACTS";

export type PositionSizeResult =
  | { kind: "computed"; positionSize: Decimal; unit: PositionSizeUnit }
  | { kind: "insufficient_data"; missing: string[]; explanation: string };

export interface CfdSizingInput {
  /** Planned risk amount in account currency. */
  riskAmount: Decimal.Value;
  /** Stop distance in price units (entry − stop, absolute). */
  stopDistance: Decimal.Value;
  /** Value of 1 pip/point per standard lot, in account currency. */
  pipOrTickValue: Decimal.Value;
  /** Only required when the instrument's quote currency ≠ account currency. */
  conversionRate?: Decimal.Value;
}

function missingDataResult(missing: string[]): PositionSizeResult {
  return {
    kind: "insufficient_data",
    missing,
    explanation: `Position size needs: ${missing.join(", ")}.`,
  };
}

/** lots = riskAmount / (stopDistance × pipOrTickValue × conversionRate). */
export function sizeCfdPosition(input: Partial<CfdSizingInput>): PositionSizeResult {
  const missing: string[] = [];
  if (input.riskAmount == null) missing.push("risk amount");
  if (input.stopDistance == null) missing.push("stop distance");
  if (input.pipOrTickValue == null) missing.push("pip/tick value");
  if (missing.length > 0) return missingDataResult(missing);

  const stopDistance = new Decimal(input.stopDistance!);
  if (!stopDistance.greaterThan(0)) return missingDataResult(["a non-zero stop distance"]);

  const conversionRate = new Decimal(input.conversionRate ?? 1);
  if (!conversionRate.greaterThan(0)) return missingDataResult(["a valid conversion rate"]);

  const denominator = stopDistance.times(input.pipOrTickValue!).times(conversionRate);
  if (!denominator.greaterThan(0)) return missingDataResult(["a non-zero pip/tick value"]);

  return { kind: "computed", positionSize: new Decimal(input.riskAmount!).dividedBy(denominator), unit: "LOTS" };
}

export interface FuturesSizingInput {
  /** Planned risk amount in account currency. */
  riskAmount: Decimal.Value;
  /** Stop distance expressed in ticks. */
  stopDistanceTicks: Decimal.Value;
  /** Dollar value of one tick, per contract. */
  tickValue: Decimal.Value;
}

/** contracts = riskAmount / (stopDistanceTicks × tickValue). */
export function sizeFuturesPosition(input: Partial<FuturesSizingInput>): PositionSizeResult {
  const missing: string[] = [];
  if (input.riskAmount == null) missing.push("risk amount");
  if (input.stopDistanceTicks == null) missing.push("stop distance in ticks");
  if (input.tickValue == null) missing.push("tick value");
  if (missing.length > 0) return missingDataResult(missing);

  const stopDistanceTicks = new Decimal(input.stopDistanceTicks!);
  if (!stopDistanceTicks.greaterThan(0)) return missingDataResult(["a non-zero stop distance in ticks"]);

  const tickValue = new Decimal(input.tickValue!);
  if (!tickValue.greaterThan(0)) return missingDataResult(["a non-zero tick value"]);

  return {
    kind: "computed",
    positionSize: new Decimal(input.riskAmount!).dividedBy(stopDistanceTicks.times(tickValue)),
    unit: "CONTRACTS",
  };
}
