import { describe, expect, it } from "vitest";

import {
  computeValuePerPriceUnit,
  dec,
  describeDistance,
  quantityForPercentOfRemaining,
  quantizeDown,
  reducePosition,
  resolveExecutionSpec,
  sizePosition,
  type ClosingFill,
  type ConversionRate,
  type ExecutionSpecLayer,
  type ResolvedExecutionSpec,
} from "@/domain/execution";
import type { DirectionLike } from "@/domain/prop-firms/risk";

/** Quantity-ledger execution engine (Phase 1) — pure domain tests A–T. */

function spec(symbol: string, overrides: { account?: ExecutionSpecLayer; user?: ExecutionSpecLayer } = {}): ResolvedExecutionSpec {
  const r = resolveExecutionSpec({ symbol, accountOverride: overrides.account, userOverride: overrides.user });
  if (r.status !== "RESOLVED") throw new Error(`${symbol} unresolved: ${JSON.stringify(r)}`);
  return r.spec;
}

function value(s: ResolvedExecutionSpec, accountCurrency = "USD", conversion?: ConversionRate) {
  const v = computeValuePerPriceUnit(s, accountCurrency, conversion);
  if (v.status !== "OK") throw new Error(`conversion required: ${v.reason}`);
  return v.accountValuePerPriceUnit;
}

function size(symbol: string, direction: DirectionLike, entry: string, stop: string, opts: { balance?: string; risk?: string; account?: ExecutionSpecLayer } = {}) {
  const s = spec(symbol, { account: opts.account });
  return sizePosition({
    direction,
    balanceBasis: opts.balance ?? "100000",
    riskPercent: opts.risk ?? "1",
    entry,
    initialStop: stop,
    spec: s,
    accountValuePerPriceUnit: value(s),
  });
}

function sized(r: ReturnType<typeof sizePosition>) {
  if (r.status !== "SIZED") throw new Error(`not sized: ${JSON.stringify(r)}`);
  return r;
}

function reduce(symbol: string, direction: DirectionLike, entry: string, initialQuantity: string, intendedRisk: string, fills: ClosingFill[], markPrice?: string) {
  const s = spec(symbol);
  const r = reducePosition({
    direction,
    entry,
    initialQuantity,
    intendedRiskAmount: intendedRisk,
    accountValuePerPriceUnit: value(s),
    quantityStep: s.quantityStep,
    fills,
    markPrice,
  });
  if (r.status !== "OK") throw new Error(`reduce invalid: ${JSON.stringify(r)}`);
  return r;
}

const str = (d: { toString(): string } | null) => (d == null ? null : d.toString());

describe("A. EURUSD sizing", () => {
  it("derives $10/pip/lot from contract size (not assumed) and floors 8.333… lots to 8.33", () => {
    const s = spec("EURUSD");
    expect(str(value(s))).toBe("100000");
    expect(str(value(s).times(s.pipSize!))).toBe("10"); // derived pip value per lot
    expect(str(describeDistance(s, "0.0012").pips)).toBe("12");

    const r = sized(size("EURUSD", "LONG", "1.0850", "1.0838"));
    expect(str(r.intendedRiskAmount)).toBe("1000");
    expect(str(r.lossPerQuantityUnit)).toBe("120");
    expect(r.rawQuantity.toDecimalPlaces(6).toString()).toBe("8.333333");
    expect(str(r.executableQuantity)).toBe("8.33");
    expect(str(r.effectiveRiskAmount)).toBe("999.6");
  });
});

describe("B. GBPUSD sizing", () => {
  it("sizes a SHORT with the stop above entry", () => {
    const r = sized(size("GBPUSD", "SHORT", "1.2700", "1.2735"));
    expect(str(r.lossPerQuantityUnit)).toBe("350");
    expect(r.rawQuantity.toDecimalPlaces(6).toString()).toBe("2.857143");
    expect(str(r.executableQuantity)).toBe("2.85");
    expect(str(r.effectiveRiskAmount)).toBe("997.5");
  });

  it("rejects a stop on the wrong side", () => {
    expect(size("GBPUSD", "SHORT", "1.2700", "1.2650")).toMatchObject({ status: "INVALID" });
    expect(size("GBPUSD", "LONG", "1.2700", "1.2700")).toMatchObject({ status: "INVALID" });
  });
});

describe("C. XAUUSD from the catalog spec", () => {
  it("resolves every field from the catalog and sizes 0.8333… → 0.83 lots", () => {
    const s = spec("XAUUSD");
    expect(s).toMatchObject({ pricingModel: "CONTRACT_SIZE", quoteCurrency: "USD", quantityUnit: "LOT" });
    expect(str(s.contractSize)).toBe("100");
    expect(str(s.quantityStep)).toBe("0.01");
    expect(s.sources).toMatchObject({ contractSize: "CATALOG", quantityStep: "CATALOG", quoteCurrency: "CATALOG" });

    const r = sized(size("XAUUSD", "LONG", "2000", "1988"));
    expect(str(r.lossPerQuantityUnit)).toBe("1200");
    expect(str(r.executableQuantity)).toBe("0.83");
    expect(str(r.effectiveRiskAmount)).toBe("996");
  });
});

describe("D. futures sizing", () => {
  it("ES: tickValue / tickSize = $50 per point; whole contracts only", () => {
    const s = spec("ES");
    expect(s).toMatchObject({ pricingModel: "TICK_VALUE", quantityUnit: "CONTRACT" });
    expect(str(value(s))).toBe("50");
    expect(str(describeDistance(s, "7").ticks)).toBe("28");
    const r = sized(size("ES", "LONG", "5000", "4993"));
    expect(str(r.lossPerQuantityUnit)).toBe("350");
    expect(str(r.executableQuantity)).toBe("2");
    expect(str(r.effectiveRiskAmount)).toBe("700");
  });

  it("MNQ is its own instrument ($2 per point), never ES/NQ economics", () => {
    expect(str(value(spec("MNQ")))).toBe("2");
    const r = sized(size("MNQ", "SHORT", "20000", "20050"));
    expect(str(r.executableQuantity)).toBe("10");
    expect(str(r.effectiveRiskAmount)).toBe("1000");
  });
});

describe("E/F. long and short PnL", () => {
  it("E. LONG: (exit − entry) × qty × value", () => {
    const r = reduce("XAUUSD", "LONG", "2000", "0.83", "1000", [{ quantity: "0.83", price: "2012" }]);
    expect(str(r.realizedPnl)).toBe("996");
    expect(str(r.realizedR)).toBe("0.996");
    const loss = reduce("XAUUSD", "LONG", "2000", "0.83", "1000", [{ quantity: "0.83", price: "1994" }]);
    expect(str(loss.realizedPnl)).toBe("-498");
  });

  it("F. SHORT: (entry − exit) × qty × value", () => {
    const win = reduce("GBPUSD", "SHORT", "1.2700", "2.85", "1000", [{ quantity: "2.85", price: "1.2630" }]);
    expect(str(win.realizedPnl)).toBe("1995");
    expect(str(win.realizedR)).toBe("1.995");
    const stopped = reduce("GBPUSD", "SHORT", "1.2700", "2.85", "1000", [{ quantity: "2.85", price: "1.2735" }]);
    expect(str(stopped.realizedPnl)).toBe("-997.5");
    expect(str(stopped.realizedR)).toBe("-0.9975");
  });
});

describe("G. full close", () => {
  it("one fill of the whole quantity closes the position", () => {
    const r = reduce("ES", "LONG", "5000", "2", "1000", [{ id: "f1", quantity: "2", price: "5010" }]);
    expect(r).toMatchObject({ fullyClosed: true });
    expect(str(r.remainingQuantity)).toBe("0");
    expect(str(r.realizedPnl)).toBe("1000");
    expect(r.fills[0]).toMatchObject({ id: "f1" });
    expect(str(r.fills[0].quantityBefore)).toBe("2");
    expect(str(r.fills[0].quantityAfter)).toBe("0");
  });

  it("no fills → open, nothing realized, no average exit", () => {
    const r = reduce("ES", "LONG", "5000", "2", "1000", []);
    expect(r.fullyClosed).toBe(false);
    expect(str(r.realizedPnl)).toBe("0");
    expect(r.weightedAverageExit).toBeNull();
  });
});

describe("H. multiple partials", () => {
  it("per-fill and cumulative PnL/R, Σ fills = total, closed + remaining = initial", () => {
    const r = reduce("EURUSD", "LONG", "1.0850", "8.33", "1000", [
      { quantity: "3", price: "1.0862" },
      { quantity: "2.33", price: "1.0874" },
      { quantity: "3", price: "1.0850" },
    ]);
    expect(r.fills.map((f) => [str(f.executedQuantity), str(f.quantityAfter), str(f.realizedPnl), str(f.realizedR)])).toEqual([
      ["3", "5.33", "360", "0.36"],
      ["2.33", "3", "559.2", "0.5592"],
      ["3", "0", "0", "0"],
    ]);
    expect(r.fills.map((f) => str(f.cumulativeRealizedPnl))).toEqual(["360", "919.2", "919.2"]);
    expect(str(r.realizedPnl)).toBe("919.2");
    expect(str(r.realizedR)).toBe("0.9192");
    expect(r.fullyClosed).toBe(true);
  });
});

describe("I. 50% of remaining, then 50% of remaining (required deterministic example)", () => {
  it("$100,000 × 1% → 0.83 lots XAUUSD; 0.41 → 0.21 → 0.21; remaining exactly 0", () => {
    const s = spec("XAUUSD");
    const sizing = sized(size("XAUUSD", "LONG", "2000", "1988"));
    expect(str(sizing.intendedRiskAmount)).toBe("1000");
    expect(sizing.rawQuantity.toDecimalPlaces(6).toString()).toBe("0.833333");
    expect(str(sizing.executableQuantity)).toBe("0.83");

    const fills: ClosingFill[] = [];
    let remaining = sizing.executableQuantity;
    const take = (percent: string, price: string) => {
      const c = quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: percent, quantityStep: s.quantityStep, minQuantity: s.minQuantity });
      if (c.status !== "OK") throw new Error(JSON.stringify(c));
      fills.push({ quantity: c.closeQuantity, price });
      remaining = c.remainingAfter;
      return c;
    };

    const first = take("50", "2012");
    expect([str(first.requestedQuantity), str(first.closeQuantity), str(first.remainingAfter)]).toEqual(["0.415", "0.41", "0.42"]);
    const second = take("50", "2024");
    expect([str(second.closeQuantity), str(second.remainingAfter)]).toEqual(["0.21", "0.21"]);
    const last = take("100", "2006");
    expect([str(last.closeQuantity), str(last.remainingAfter)]).toEqual(["0.21", "0"]);

    const r = reducePosition({
      direction: "LONG",
      entry: "2000",
      initialQuantity: sizing.executableQuantity,
      intendedRiskAmount: sizing.intendedRiskAmount,
      accountValuePerPriceUnit: value(s),
      quantityStep: s.quantityStep,
      fills,
    });
    if (r.status !== "OK") throw new Error(r.reason);
    expect(r.fills.map((f) => [str(f.executedQuantity), str(f.quantityAfter), str(f.realizedPnl), str(f.realizedR), str(f.cumulativeRealizedR)])).toEqual([
      ["0.41", "0.42", "492", "0.492", "0.492"],
      ["0.21", "0.21", "504", "0.504", "0.996"],
      ["0.21", "0", "126", "0.126", "1.122"],
    ]);
    expect(str(r.realizedPnl)).toBe("1122");
    expect(str(r.realizedR)).toBe("1.122");
    expect(str(r.remainingQuantity)).toBe("0");
    expect(r.fullyClosed).toBe(true);
  });
});

describe("J. quantity-step rounding", () => {
  it("always quantizes DOWN to an exact multiple of the step", () => {
    expect(str(quantizeDown(dec("0.839999"), dec("0.01")))).toBe("0.83");
    expect(str(quantizeDown(dec("8.3333333"), dec("0.1")))).toBe("8.3");
    expect(str(quantizeDown(dec("2.99"), dec("1")))).toBe("2");
    expect(str(quantizeDown(dec("0.005"), dec("0.01")))).toBe("0");
  });

  it("an account step override changes executable quantity", () => {
    const tenth = sized(size("EURUSD", "LONG", "1.0850", "1.0838", { account: { quantityStep: "0.1", minQuantity: "0.1" } }));
    expect(str(tenth.executableQuantity)).toBe("8.3");
    expect(str(tenth.effectiveRiskAmount)).toBe("996");
  });

  it("a fill quantity off the step is rejected", () => {
    const s = spec("XAUUSD");
    const r = reducePosition({ direction: "LONG", entry: "2000", initialQuantity: "0.83", intendedRiskAmount: "1000", accountValuePerPriceUnit: value(s), quantityStep: s.quantityStep, fills: [{ quantity: "0.415", price: "2010" }] });
    expect(r).toMatchObject({ status: "INVALID", fillIndex: 0 });
  });
});

describe("K. minimum quantity rejection", () => {
  it("never raises quantity to the minimum — CANNOT_SIZE_WITHIN_RISK", () => {
    const r = size("XAUUSD", "LONG", "2000", "1988", { balance: "1000", risk: "1" });
    expect(r.status).toBe("CANNOT_SIZE_WITHIN_RISK");
    if (r.status !== "CANNOT_SIZE_WITHIN_RISK") return;
    expect(str(r.intendedRiskAmount)).toBe("10");
    expect(str(r.minQuantity)).toBe("0.01");
    expect(str(r.riskAtMinQuantity)).toBe("12");
  });

  it("futures: less than one contract within risk", () => {
    const r = size("ES", "LONG", "5000", "4993", { risk: "0.1" });
    expect(r).toMatchObject({ status: "CANNOT_SIZE_WITHIN_RISK", reason: "BELOW_MIN_QUANTITY" });
  });

  it("an account minimum above the floored size rejects too", () => {
    const r = size("EURUSD", "LONG", "1.0850", "1.0838", { account: { minQuantity: "10" } });
    expect(r.status).toBe("CANNOT_SIZE_WITHIN_RISK");
  });
});

describe("L. maximum quantity handling", () => {
  it("caps at maxQuantity (less risk, flagged) — never above", () => {
    const r = sized(size("EURUSD", "LONG", "1.0850", "1.0838", { account: { maxQuantity: "5" } }));
    expect(str(r.executableQuantity)).toBe("5");
    expect(r.cappedAtMax).toBe(true);
    expect(str(r.effectiveRiskAmount)).toBe("600");
    expect(str(r.intendedRiskAmount)).toBe("1000");
  });

  it("an inconsistent max is an explicit invalid spec", () => {
    const r = resolveExecutionSpec({ symbol: "EURUSD", accountOverride: { maxQuantity: "5.005" } });
    expect(r.status).toBe("INSUFFICIENT");
    if (r.status === "INSUFFICIENT") expect(r.invalid.join(" ")).toMatch(/maxQuantity must be a multiple/);
  });
});

describe("M. residual absorption / final close", () => {
  const close = (remaining: string, percent: string, min = "0.02", absorb?: boolean) =>
    quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: percent, quantityStep: "0.01", minQuantity: min, absorbResidualBelowMin: absorb });

  it("absorbs a leftover below the minimum into the close", () => {
    const r = close("0.05", "80");
    expect(r).toMatchObject({ status: "OK", closesPosition: true });
    if (r.status !== "OK") return;
    expect([str(r.closeQuantity), str(r.absorbedResidual), str(r.remainingAfter)]).toEqual(["0.05", "0.01", "0"]);
  });

  it("keeps a leftover at or above the minimum", () => {
    const r = close("0.03", "50", "0.01");
    if (r.status !== "OK") throw new Error();
    expect([str(r.closeQuantity), str(r.remainingAfter), str(r.absorbedResidual)]).toEqual(["0.01", "0.02", "0"]);
  });

  it("absorption can be disabled", () => {
    const r = close("0.05", "80", "0.02", false);
    if (r.status !== "OK") throw new Error();
    expect([str(r.closeQuantity), str(r.remainingAfter)]).toEqual(["0.04", "0.01"]);
  });

  it("a request below one step or below the minimum is explicit, never rounded up", () => {
    expect(close("0.01", "50", "0.01")).toMatchObject({ status: "BELOW_STEP" });
    expect(close("1", "5", "0.1")).toMatchObject({ status: "BELOW_MIN_QUANTITY" });
    expect(close("0", "50")).toMatchObject({ status: "INVALID" });
    expect(close("0.05", "120")).toMatchObject({ status: "INVALID" });
  });

  it("100% always closes exactly the remaining quantity", () => {
    const r = close("0.37", "100");
    if (r.status !== "OK") throw new Error();
    expect([str(r.closeQuantity), str(r.remainingAfter)]).toEqual(["0.37", "0"]);
  });
});

describe("N. intended vs effective risk", () => {
  it("a stop-out at the rounded quantity is −0.996R against intended risk — not normalized to −1R", () => {
    const s = sized(size("XAUUSD", "LONG", "2000", "1988"));
    expect(str(s.intendedRiskAmount)).toBe("1000");
    expect(str(s.effectiveRiskAmount)).toBe("996");
    expect(str(s.riskShortfall)).toBe("4");
    const r = reduce("XAUUSD", "LONG", "2000", "0.83", str(s.intendedRiskAmount)!, [{ quantity: "0.83", price: "1988" }]);
    expect(str(r.realizedPnl)).toBe("-996");
    expect(str(r.realizedR)).toBe("-0.996");
  });

  it("the budget is floored to cents so it never exceeds balance × risk%", () => {
    const s = sized(size("XAUUSD", "LONG", "2000", "1988", { balance: "12345.678", risk: "1" }));
    expect(str(s.intendedRiskAmount)).toBe("123.45");
  });
});

describe("O. weighted average exit", () => {
  it("is Σ(price × qty) / Σ qty", () => {
    const r = reduce("XAUUSD", "LONG", "2000", "0.83", "1000", [
      { quantity: "0.41", price: "2012" },
      { quantity: "0.21", price: "2024" },
      { quantity: "0.21", price: "2006" },
    ]);
    expect(r.weightedAverageExit!.toDecimalPlaces(9).toString()).toBe("2013.518072289");
    // realized PnL equals (avgExit − entry) × closed qty × value
    expect(r.weightedAverageExit!.minus(2000).times("0.83").times(100).toDecimalPlaces(10).toString()).toBe("1122");
  });
});

describe("P. unrealized PnL", () => {
  it("marks the remaining quantity only", () => {
    const r = reduce("XAUUSD", "LONG", "2000", "0.83", "1000", [{ quantity: "0.41", price: "2012" }], "2010");
    expect(str(r.remainingQuantity)).toBe("0.42");
    expect(str(r.unrealizedPnl)).toBe("420");
    expect(str(r.unrealizedR)).toBe("0.42");
    expect(str(r.realizedPnl)).toBe("492");
  });

  it("short side and fully-closed", () => {
    const short = reduce("GBPUSD", "SHORT", "1.2700", "2.85", "1000", [], "1.2720");
    expect(str(short.unrealizedPnl)).toBe("-570");
    const closed = reduce("GBPUSD", "SHORT", "1.2700", "2.85", "1000", [{ quantity: "2.85", price: "1.2600" }], "1.3000");
    expect(str(closed.unrealizedPnl)).toBe("0");
  });

  it("no mark → null", () => {
    expect(reduce("ES", "LONG", "5000", "2", "1000", []).unrealizedPnl).toBeNull();
  });
});

describe("Q. missing spec", () => {
  it("index CFD without a broker contract size is INSUFFICIENT", () => {
    const r = resolveExecutionSpec({ symbol: "NAS100" });
    expect(r.status).toBe("INSUFFICIENT");
    if (r.status === "INSUFFICIENT") expect(r.missing).toEqual(expect.arrayContaining(["contractSize", "quantityStep", "minQuantity", "quantityUnit"]));
  });

  it("unknown symbols and broker-suffixed spellings are not guessed", () => {
    for (const symbol of ["FOOBAR", "XAUUSD.a", "EURUSDm"]) {
      const r = resolveExecutionSpec({ symbol });
      expect(r.status).toBe("INSUFFICIENT");
      if (r.status === "INSUFFICIENT") expect(r.missing).toEqual(expect.arrayContaining(["pricingModel", "quoteCurrency"]));
    }
  });

  it("a user-supplied CFD spec fills the gap; account override beats user override", () => {
    const user: ExecutionSpecLayer = { contractSize: "1", quantityUnit: "LOT", quantityStep: "0.1", minQuantity: "0.1" };
    const u = spec("NAS100", { user });
    expect(u.pricingModel).toBe("CONTRACT_SIZE");
    expect(u.sources).toMatchObject({ pricingModel: "CATALOG", contractSize: "USER_OVERRIDE", quoteCurrency: "CATALOG", quantityStep: "USER_OVERRIDE" });

    // Without a catalog entry the model is inferred only from which economics were stated.
    const custom = spec("MYCFD", { user: { ...user, quoteCurrency: "USD" } });
    expect(custom.pricingModel).toBe("CONTRACT_SIZE");
    expect(custom.sources.pricingModel).toBeUndefined();

    const a = spec("NAS100", { user, account: { contractSize: "10" } });
    expect(str(a.contractSize)).toBe("10");
    expect(a.sources).toMatchObject({ contractSize: "ACCOUNT_OVERRIDE", quantityStep: "USER_OVERRIDE" });
  });

  it("ambiguous economics (both contract size and tick value, no model) must be stated", () => {
    const r = resolveExecutionSpec({
      symbol: "CUSTOM",
      userOverride: { quoteCurrency: "USD", contractSize: "1", tickSize: "0.5", tickValue: "5", quantityUnit: "UNIT", quantityStep: "1", minQuantity: "1" },
    });
    expect(r).toMatchObject({ status: "INSUFFICIENT", missing: ["pricingModel"] });
  });

  it("non-positive values are invalid, not coerced", () => {
    const r = resolveExecutionSpec({ symbol: "EURUSD", accountOverride: { contractSize: "0" } });
    expect(r.status).toBe("INSUFFICIENT");
  });
});

describe("R. currency conversion required", () => {
  it("USDJPY in a USD account needs an explicit JPY→USD rate", () => {
    const s = spec("USDJPY");
    expect(computeValuePerPriceUnit(s, "USD")).toMatchObject({ status: "CONVERSION_REQUIRED", from: "JPY", to: "USD" });
    expect(computeValuePerPriceUnit(s, "USD", { from: "USD", to: "JPY", rate: "150" })).toMatchObject({ status: "CONVERSION_REQUIRED" });
    expect(computeValuePerPriceUnit(s, "USD", { from: "JPY", to: "USD", rate: "0" })).toMatchObject({ status: "CONVERSION_REQUIRED" });

    const v = value(s, "USD", { from: "JPY", to: "USD", rate: "0.0065" });
    expect(str(v)).toBe("650");
    const r = sized(sizePosition({ direction: "LONG", balanceBasis: "100000", riskPercent: "1", entry: "150.00", initialStop: "149.50", spec: s, accountValuePerPriceUnit: v }));
    expect(str(r.executableQuantity)).toBe("3.07");
    expect(str(r.effectiveRiskAmount)).toBe("997.75");
  });

  it("never assumes 1:1 across currencies; same currency is identity", () => {
    expect(computeValuePerPriceUnit(spec("EURUSD"), "EUR")).toMatchObject({ status: "CONVERSION_REQUIRED", from: "USD", to: "EUR" });
    const ger = spec("GER40", { user: { contractSize: "1", quantityUnit: "LOT", quantityStep: "0.1", minQuantity: "0.1" } });
    expect(computeValuePerPriceUnit(ger, "EUR")).toMatchObject({ status: "OK" });
    expect(computeValuePerPriceUnit(ger, "USD")).toMatchObject({ status: "CONVERSION_REQUIRED", from: "EUR", to: "USD" });
  });
});

describe("S. Decimal precision / no dust", () => {
  it("0.1 + 0.2 lots close a 0.3 position to exactly zero", () => {
    const r = reduce("EURUSD", "LONG", "1.1", "0.3", "100", [
      { quantity: 0.1, price: "1.1001" },
      { quantity: 0.2, price: "1.1003" },
    ]);
    expect(str(r.remainingQuantity)).toBe("0");
    expect(r.fullyClosed).toBe(true);
    expect(str(r.realizedPnl)).toBe("7");
  });

  it("thirty 0.01 closes of 0.30 leave exactly zero; Σ PnL is exact", () => {
    const fills = Array.from({ length: 30 }, () => ({ quantity: "0.01", price: "1.1013" }));
    const r = reduce("EURUSD", "LONG", "1.1", "0.3", "100", fills);
    expect(str(r.remainingQuantity)).toBe("0");
    expect(str(r.realizedPnl)).toBe("39"); // 30 × 1.30 (0.0013 × 0.01 × 100000)
  });

  it("repeated 50%-of-remaining walks down in exact steps until it must close all", () => {
    let remaining = dec("0.83");
    const closes: string[] = [];
    for (let i = 0; i < 20 && remaining.greaterThan(0); i++) {
      const c = quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: "50", quantityStep: "0.01", minQuantity: "0.01" });
      const step = c.status === "OK" ? c : quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: "100", quantityStep: "0.01", minQuantity: "0.01" });
      if (step.status !== "OK") throw new Error();
      closes.push(step.closeQuantity.toString());
      remaining = step.remainingAfter;
    }
    expect(closes).toEqual(["0.41", "0.21", "0.1", "0.05", "0.03", "0.01", "0.01", "0.01"]);
    expect(remaining.toString()).toBe("0");
    expect(closes.reduce((s, q) => s.plus(q), dec(0)).toString()).toBe("0.83");
  });

  it("booked fill PnL rounds HALF-EVEN to cents; moneyScale null keeps it exact", () => {
    const s = spec("XAUUSD");
    const base = { direction: "LONG" as const, entry: "2000", initialQuantity: "0.02", intendedRiskAmount: "24", accountValuePerPriceUnit: value(s), quantityStep: s.quantityStep };
    const fills = [
      { quantity: "0.01", price: "2000.005" }, // 0.005 → 0.00
      { quantity: "0.01", price: "2000.015" }, // 0.015 → 0.02
    ];
    const booked = reducePosition({ ...base, fills });
    const exact = reducePosition({ ...base, fills, moneyScale: null });
    if (booked.status !== "OK" || exact.status !== "OK") throw new Error();
    expect(booked.fills.map((f) => str(f.realizedPnl))).toEqual(["0", "0.02"]);
    expect(str(booked.realizedPnl)).toBe("0.02");
    expect(str(exact.realizedPnl)).toBe("0.02");
    expect(exact.fills.map((f) => str(f.realizedPnl))).toEqual(["0.005", "0.015"]);
  });

  it("invariants hold over a deterministic pseudo-random fill sequence", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 50; run++) {
      const initial = dec(Math.floor(rand() * 500) + 1).times("0.01");
      let remaining = initial;
      const fills: ClosingFill[] = [];
      while (remaining.greaterThan(0) && fills.length < 12) {
        const pct = String(Math.floor(rand() * 100) + 1);
        const c = quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: pct, quantityStep: "0.01", minQuantity: "0.01" });
        if (c.status !== "OK") continue;
        fills.push({ quantity: c.closeQuantity, price: dec(2000).plus(dec(Math.floor(rand() * 4000) - 2000).times("0.01")) });
        remaining = c.remainingAfter;
      }
      const r = reduce("XAUUSD", rand() > 0.5 ? "LONG" : "SHORT", "2000", initial.toString(), "1000", fills);
      const closedSum = r.fills.reduce((s, f) => s.plus(f.executedQuantity), dec(0));
      const pnlSum = r.fills.reduce((s, f) => s.plus(f.realizedPnl), dec(0));
      expect(closedSum.plus(r.remainingQuantity).equals(initial)).toBe(true);
      expect(pnlSum.equals(r.realizedPnl)).toBe(true);
      expect(r.realizedR.equals(r.realizedPnl.dividedBy(1000))).toBe(true);
      expect(r.fullyClosed).toBe(r.remainingQuantity.isZero());
      for (const f of r.fills) {
        expect(f.executedQuantity.greaterThan(0)).toBe(true);
        expect(f.executedQuantity.lessThanOrEqualTo(f.quantityBefore)).toBe(true);
        expect(f.quantityAfter.equals(f.quantityBefore.minus(f.executedQuantity))).toBe(true);
        expect(f.quantityAfter.isNegative()).toBe(false);
      }
    }
  });

  it("rejects fills that would over-close, zero/negative quantities, and bad initial quantity", () => {
    const s = spec("XAUUSD");
    const base = { direction: "LONG" as const, entry: "2000", intendedRiskAmount: "1000", accountValuePerPriceUnit: value(s), quantityStep: s.quantityStep };
    expect(reducePosition({ ...base, initialQuantity: "0.83", fills: [{ quantity: "0.5", price: "2010" }, { quantity: "0.34", price: "2010" }] })).toMatchObject({ status: "INVALID", fillIndex: 1 });
    expect(reducePosition({ ...base, initialQuantity: "0.83", fills: [{ quantity: "0", price: "2010" }] })).toMatchObject({ status: "INVALID", fillIndex: 0 });
    expect(reducePosition({ ...base, initialQuantity: "0.83", fills: [{ quantity: "-0.1", price: "2010" }] })).toMatchObject({ status: "INVALID", fillIndex: 0 });
    expect(reducePosition({ ...base, initialQuantity: "0", fills: [] })).toMatchObject({ status: "INVALID", fillIndex: null });
    expect(reducePosition({ ...base, initialQuantity: "0.835", fills: [] })).toMatchObject({ status: "INVALID", fillIndex: null });
    expect(reducePosition({ ...base, initialQuantity: "0.83", intendedRiskAmount: "0", fills: [] })).toMatchObject({ status: "INVALID" });
  });
});
