import { describe, expect, it } from "vitest";
import type { Decimal } from "decimal.js";

import { dec, reducePosition, type DecimalInput } from "@/domain/execution";
import { computeRealizedR, type ExitInput } from "@/domain/performance/realized-r";
import type { DirectionLike } from "@/domain/prop-firms/risk";

/**
 * T. Regression vs the legacy proportion-weighted computeRealizedR.
 *
 * TESTING ONLY. `engineRFromLegacyShape` lives inside this test file on
 * purpose: it is a proof that the quantity engine reproduces the legacy R
 * under the legacy assumptions — unrounded quantity (intended risk =
 * quantity × stop distance × value, i.e. effective = intended), exit
 * percentages as weights of the ORIGINAL position, no fees, same spec. It
 * is not, and must never become, a conversion/backfill path: legacy trades
 * have no quantity, and none is invented for them.
 */
function engineRFromLegacyShape(
  direction: DirectionLike,
  entry: DecimalInput,
  initialStop: DecimalInput,
  exits: ExitInput[],
  notionalQuantity: DecimalInput,
  valuePerPriceUnit: DecimalInput,
): Decimal {
  const q = dec(notionalQuantity);
  const stopDistance = dec(entry).minus(initialStop).abs();
  const intendedRisk = q.times(stopDistance).times(valuePerPriceUnit);
  const r = reducePosition({
    direction,
    entry,
    initialQuantity: q,
    intendedRiskAmount: intendedRisk,
    accountValuePerPriceUnit: valuePerPriceUnit,
    quantityStep: "1e-20",
    fills: exits.map((e) => ({ quantity: q.times(e.proportion).dividedBy(100), price: e.price })),
    moneyScale: null,
  });
  if (r.status !== "OK") throw new Error(r.reason);
  if (!r.fullyClosed) throw new Error("legacy shape must close 100%");
  return r.realizedR;
}

const cases: { name: string; direction: DirectionLike; entry: string; stop: string; exits: ExitInput[]; qty: string; value: string }[] = [
  { name: "XAUUSD single TP", direction: "LONG", entry: "2000", stop: "1988", exits: [{ price: "2024", proportion: 100 }], qty: "0.8", value: "100" },
  { name: "XAUUSD stop-out", direction: "LONG", entry: "2000", stop: "1988", exits: [{ price: "1988", proportion: 100 }], qty: "0.8", value: "100" },
  {
    name: "EURUSD three partials",
    direction: "LONG",
    entry: "1.0850",
    stop: "1.0838",
    exits: [
      { price: "1.0862", proportion: 50 },
      { price: "1.0874", proportion: 25 },
      { price: "1.0850", proportion: 25 },
    ],
    qty: "8",
    value: "100000",
  },
  {
    name: "GBPUSD short, mixed",
    direction: "SHORT",
    entry: "1.2700",
    stop: "1.2735",
    exits: [
      { price: "1.2650", proportion: 30 },
      { price: "1.2720", proportion: 70 },
    ],
    qty: "2.5",
    value: "100000",
  },
  {
    name: "ES thirds",
    direction: "LONG",
    entry: "5000",
    stop: "4993",
    exits: [
      { price: "5007", proportion: "33.3333" },
      { price: "5014", proportion: "33.3333" },
      { price: "4996", proportion: "33.3334" },
    ],
    qty: "3",
    value: "50",
  },
];

describe("T. regression versus computeRealizedR", () => {
  for (const c of cases) {
    it(c.name, () => {
      const legacy = computeRealizedR(c.direction, c.entry, c.stop, c.exits);
      expect(legacy.fullyClosed).toBe(true);
      const engine = engineRFromLegacyShape(c.direction, c.entry, c.stop, c.exits, c.qty, c.value);
      expect(engine.toDecimalPlaces(12).toString()).toBe(legacy.realizedR!.toDecimalPlaces(12).toString());
    });
  }

  it("diverges — by design — once quantity is rounded to the step (intended ≠ effective)", () => {
    // 0.83 lots against a $1,000 intended budget: legacy says −1R, the engine says −0.996R.
    const legacy = computeRealizedR("LONG", "2000", "1988", [{ price: "1988", proportion: 100 }]);
    const r = reducePosition({
      direction: "LONG",
      entry: "2000",
      initialQuantity: "0.83",
      intendedRiskAmount: "1000",
      accountValuePerPriceUnit: "100",
      quantityStep: "0.01",
      fills: [{ quantity: "0.83", price: "1988" }],
    });
    expect(legacy.realizedR!.toString()).toBe("-1");
    expect(r.status === "OK" && r.realizedR.toString()).toBe("-0.996");
  });
});
