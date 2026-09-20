import { describe, expect, it } from "vitest";

import { chartContextsEqual, type TradingViewChartContext } from "./chart-context";

function ctx(overrides: Partial<TradingViewChartContext> = {}): TradingViewChartContext {
  return {
    symbol: { raw: "OANDA:XAUUSD", display: "XAUUSD", exchange: "OANDA" },
    timeframe: "5m",
    detected: true,
    symbolSource: "url",
    timeframeSource: "title",
    updatedAt: 1,
    ...overrides,
  };
}

describe("chartContextsEqual", () => {
  it("treats two contexts with the same symbol/timeframe/sources as equal, ignoring updatedAt", () => {
    expect(chartContextsEqual(ctx({ updatedAt: 1 }), ctx({ updatedAt: 999_999 }))).toBe(true);
  });

  it("treats a different symbol as unequal", () => {
    expect(chartContextsEqual(ctx(), ctx({ symbol: { raw: "OANDA:EURUSD", display: "EURUSD", exchange: "OANDA" } }))).toBe(false);
  });

  it("treats null vs. a symbol as unequal", () => {
    expect(chartContextsEqual(ctx(), ctx({ symbol: null }))).toBe(false);
  });

  it("treats a different timeframe as unequal", () => {
    expect(chartContextsEqual(ctx(), ctx({ timeframe: "1h" }))).toBe(false);
  });

  it("treats a different detection source as unequal, even with the same value", () => {
    expect(chartContextsEqual(ctx({ symbolSource: "url" }), ctx({ symbolSource: "title" }))).toBe(false);
  });

  it("treats a different `detected` flag as unequal", () => {
    expect(chartContextsEqual(ctx({ detected: true }), ctx({ detected: false }))).toBe(false);
  });

  it("two fully-empty contexts are equal", () => {
    const empty: TradingViewChartContext = { symbol: null, timeframe: null, detected: false, symbolSource: null, timeframeSource: null, updatedAt: 1 };
    expect(chartContextsEqual(empty, { ...empty, updatedAt: 2 })).toBe(true);
  });
});
