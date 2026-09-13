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
