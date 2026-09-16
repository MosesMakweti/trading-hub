import { describe, expect, it } from "vitest";

import { aggregateCandles, bucketStart } from "@/domain/market-data/aggregation";
import type { Candle } from "@/domain/market-data/candle";

const MIN = 60_000;
const H = Date.UTC(2026, 7, 3, 10, 0, 0); // 2026-08-03 10:00 UTC — an exact hour boundary

function candle(minutesAfter: number, o: number, h: number, l: number, cl: number, vol: number | null = null): Candle {
  return { timestamp: H + minutesAfter * MIN, open: o, high: h, low: l, close: cl, volume: vol };
}

describe("bucketStart", () => {
  it("aligns to UTC-epoch boundaries, not calendar-local ones", () => {
    expect(bucketStart(H + 37 * MIN, "1h")).toBe(H);
    expect(bucketStart(H - 1, "1h")).toBe(H - 60 * MIN);
  });
});

describe("aggregateCandles", () => {
  it("open = first, high = max, low = min, close = last, volume = sum", () => {
    const oneMin = [
      candle(0, 100, 101, 99, 100.5, 10),
      candle(1, 100.5, 102, 100, 101, 20),
      candle(2, 101, 101.2, 98, 99, 15),
      candle(3, 99, 99.5, 98.5, 99.2, 5),
      candle(4, 99.2, 100, 99, 99.8, 0),
    ];
    const [fiveMin] = aggregateCandles(oneMin, "5m");
    expect(fiveMin.timestamp).toBe(H);
    expect(fiveMin.open).toBe(100); // first
    expect(fiveMin.high).toBe(102); // max across all 5
    expect(fiveMin.low).toBe(98); // min across all 5
    expect(fiveMin.close).toBe(99.8); // last
    expect(fiveMin.volume).toBe(50); // sum
  });

  it("volume is null when any candle in the bucket lacks it (never treated as 0)", () => {
    const oneMin = [candle(0, 100, 101, 99, 100, 10), candle(1, 100, 101, 99, 100, null)];
    const [agg] = aggregateCandles(oneMin, "5m");
    expect(agg.volume).toBeNull();
  });

  it("respects time boundaries — candles in different buckets never mix", () => {
    const oneMin = [
      candle(4, 100, 101, 99, 100.5), // bucket [H, H+5m)
      candle(5, 200, 201, 199, 200.5), // bucket [H+5m, H+10m)
    ];
    const buckets = aggregateCandles(oneMin, "5m");
    expect(buckets).toHaveLength(2);
    expect(buckets[0].timestamp).toBe(H);
    expect(buckets[1].timestamp).toBe(H + 5 * MIN);
    expect(buckets[0].close).toBe(100.5);
    expect(buckets[1].open).toBe(200);
  });

  it("returns buckets in ascending time order regardless of input order", () => {
    const oneMin = [candle(65, 1, 1, 1, 1), candle(5, 2, 2, 2, 2), candle(0, 3, 3, 3, 3)];
    const hours = aggregateCandles(oneMin, "1h");
    expect(hours.map((c) => c.timestamp)).toEqual([H, H + 60 * MIN]);
  });

  it("handles an empty input safely", () => {
    expect(aggregateCandles([], "1h")).toEqual([]);
  });

  it("a single base candle aggregates to itself (open=high=...=that candle's own values within the bucket)", () => {
    const only = [candle(0, 100, 103, 97, 101, 7)];
    const [agg] = aggregateCandles(only, "15m");
    expect(agg).toEqual({ timestamp: H, open: 100, high: 103, low: 97, close: 101, volume: 7 });
  });
});

/**
 * Stage 21.2 §10/§11 — explicit per-timeframe proof for every canonical
 * derived timeframe (30m/4h/1D specifically; 5m/15m/1h are already covered
 * above and share the exact same code path, since `aggregateCandles` is
 * timeframe-agnostic). Confirms both the OHLCV math AND the exact UTC
 * bucket-boundary alignment for each.
 */
describe("aggregation — explicit M30/H4/D1 proof (Stage 21.2 §10-11)", () => {
  it("M30: buckets align to :00/:30 past the hour (UTC-epoch-aligned, not calendar-local)", () => {
    const oneMin: Candle[] = [];
    for (let m = 0; m < 60; m += 1) oneMin.push(candle(m, 100 + m, 100 + m + 0.5, 100 + m - 0.5, 100 + m));
    const buckets = aggregateCandles(oneMin, "30m");
    expect(buckets.map((b) => b.timestamp)).toEqual([H, H + 30 * MIN]);
    expect(buckets[0]).toEqual({ timestamp: H, open: 100, high: 129.5, low: 99.5, close: 129, volume: null });
    expect(buckets[1]).toEqual({ timestamp: H + 30 * MIN, open: 130, high: 159.5, low: 129.5, close: 159, volume: null });
  });

  it("H4: buckets align to every 4th hour from UTC epoch (00:00/04:00/08:00/... UTC, since 1970-01-01T00:00Z is itself a 4h boundary)", () => {
    // H (2026-08-03 10:00 UTC) is NOT a 4h-aligned instant — the enclosing
    // bucket must be 08:00-12:00 UTC, not 10:00-14:00.
    const fourHBucketStart = Date.UTC(2026, 7, 3, 8, 0, 0);
    expect(bucketStart(H, "4h")).toBe(fourHBucketStart);

    const oneMin: Candle[] = [candle(0, 100, 101, 99, 100), candle(4 * 60, 200, 201, 199, 200)]; // 10:00 and 14:00 — different H4 buckets
    const buckets = aggregateCandles(oneMin, "4h");
    expect(buckets.map((b) => b.timestamp)).toEqual([fourHBucketStart, fourHBucketStart + 4 * 60 * MIN]);
  });

  it("D1: buckets align to UTC midnight, never a local calendar day", () => {
    const dayStart = Date.UTC(2026, 7, 3, 0, 0, 0);
    // A candle at 23:59 UTC and one at 00:01 UTC the next day must fall in DIFFERENT D1 buckets.
    const lateOnDay0 = { timestamp: dayStart + 23 * 60 * MIN + 59 * MIN, open: 100, high: 101, low: 99, close: 100, volume: null };
    const earlyOnDay1 = { timestamp: dayStart + 24 * 60 * MIN + 1 * MIN, open: 200, high: 201, low: 199, close: 200, volume: null };
    const buckets = aggregateCandles([lateOnDay0, earlyOnDay1], "1D");
    expect(buckets.map((b) => b.timestamp)).toEqual([dayStart, dayStart + 24 * 60 * MIN]);
    expect(buckets[0].close).toBe(100);
    expect(buckets[1].open).toBe(200);
  });
});
