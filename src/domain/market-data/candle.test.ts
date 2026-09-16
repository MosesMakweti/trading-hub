import { describe, expect, it } from "vitest";

import { isValidCandle, compareCandles, mergeCandles, type Candle } from "@/domain/market-data/candle";

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

describe("mergeCandles — Stage 21.2 §7 chunk-boundary merge correctness", () => {
  it("merges two disjoint chunks into one ascending, gap-free series", () => {
    const chunkA = [c({ timestamp: 0 }), c({ timestamp: 60_000 })];
    const chunkB = [c({ timestamp: 120_000 }), c({ timestamp: 180_000 })];
    const merged = mergeCandles(chunkA, chunkB);
    expect(merged.map((x) => x.timestamp)).toEqual([0, 60_000, 120_000, 180_000]);
  });

  it("is order-independent — a background chunk arriving before the rolling-window chunk still merges correctly", () => {
    const later = [c({ timestamp: 120_000 })];
    const earlier = [c({ timestamp: 0 })];
    // Simulates the background sweep resolving before the priority window fetch.
    expect(mergeCandles(later, earlier).map((x) => x.timestamp)).toEqual([0, 120_000]);
  });

  it("de-duplicates an exact boundary candle present in both chunks (e.g. an inclusive day-boundary re-fetch)", () => {
    const chunkA = [c({ timestamp: 0 }), c({ timestamp: 60_000 })];
    const chunkB = [c({ timestamp: 60_000 }), c({ timestamp: 120_000 })]; // 60_000 duplicated across the boundary
    const merged = mergeCandles(chunkA, chunkB);
    expect(merged.map((x) => x.timestamp)).toEqual([0, 60_000, 120_000]);
  });

  it("prefers the EXISTING candle over an incoming duplicate at the same timestamp, never silently overwriting cached data", () => {
    const existing = [c({ timestamp: 0, close: 111 })];
    const incoming = [c({ timestamp: 0, close: 222 })]; // a re-fetch that (hypothetically) returned a different value
    const merged = mergeCandles(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].close).toBe(111);
  });

  it("never drops or duplicates a boundary candle across three sequential chunk merges (simulating the real prefetch sweep)", () => {
    let all: Candle[] = [];
    all = mergeCandles(all, [c({ timestamp: 0 }), c({ timestamp: 60_000 })]);
    all = mergeCandles(all, [c({ timestamp: 60_000 }), c({ timestamp: 120_000 })]);
    all = mergeCandles(all, [c({ timestamp: 120_000 }), c({ timestamp: 180_000 })]);
    expect(all.map((x) => x.timestamp)).toEqual([0, 60_000, 120_000, 180_000]);
  });

  it("handles an empty existing array (the very first chunk for a freshly-selected asset)", () => {
    expect(mergeCandles([], [c({ timestamp: 0 })])).toHaveLength(1);
  });
});
