import { describe, expect, it } from "vitest";

import { isValidCandle, compareCandles, type Candle } from "@/domain/market-data/candle";

const c = (overrides: Partial<Candle> = {}): Candle => ({
  timestamp: 0,
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: null,
  ...overrides,
});

describe("isValidCandle", () => {
  it("accepts a coherent OHLC candle", () => {
    expect(isValidCandle(c())).toBe(true);
  });

  it("rejects a candle whose high is below its low", () => {
    expect(isValidCandle(c({ high: 90, low: 95 }))).toBe(false);
  });

  it("rejects a candle whose high is below its open or close", () => {
    expect(isValidCandle(c({ high: 99, open: 100 }))).toBe(false);
    expect(isValidCandle(c({ high: 99, close: 100 }))).toBe(false);
  });

  it("rejects a candle whose low is above its open or close", () => {
    expect(isValidCandle(c({ low: 101, open: 100 }))).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isValidCandle(c({ close: NaN }))).toBe(false);
  });
});

describe("compareCandles", () => {
  it("sorts ascending by timestamp", () => {
    const candles = [c({ timestamp: 300 }), c({ timestamp: 100 }), c({ timestamp: 200 })];
    expect(candles.sort(compareCandles).map((x) => x.timestamp)).toEqual([100, 200, 300]);
  });
});
