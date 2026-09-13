import { describe, expect, it } from "vitest";

import { buildHigherTimeframeView, visibleCandles } from "@/domain/market-data/visible-candles";
import type { Candle } from "@/domain/market-data/candle";

const MIN = 60_000;
const DAY_START = Date.UTC(2026, 7, 3, 0, 0, 0); // 2026-08-03 00:00 UTC

function candle(minutesAfterMidnight: number, close = 100): Candle {
  const t = DAY_START + minutesAfterMidnight * MIN;
  return { timestamp: t, open: close, high: close + 1, low: close - 1, close, volume: null };
}

describe("visibleCandles — the no-hindsight rule (§11-12)", () => {
  it("a candle that has fully closed at or before replayTime is visible", () => {
    // 5m candle at 10:00 closes at 10:05 — visible exactly at replayTime 10:05.
    const c = candle(10 * 60);
    expect(visibleCandles([c], DAY_START + 10 * 60 * MIN + 5 * MIN, "5m")).toHaveLength(1);
  });

  it("a candle still open at replayTime is NOT visible — the exact boundary case", () => {
    const c = candle(10 * 60); // 10:00-10:05
    // One millisecond before close: must not be visible yet.
    expect(visibleCandles([c], DAY_START + 10 * 60 * MIN + 5 * MIN - 1, "5m")).toHaveLength(0);
  });

  it("excludes every candle whose close time is after replayTime — never a future candle in the series", () => {
    const candles = [candle(0), candle(5), candle(10), candle(15)]; // 5m candles at :00,:05,:10,:15
    const visible = visibleCandles(candles, DAY_START + 12 * MIN, "5m"); // replay at 00:12
    // Only :00-:05 (closes :05) and :05-:10 (closes :10) have closed by 00:12.
    expect(visible.map((c) => c.timestamp)).toEqual([candles[0].timestamp, candles[1].timestamp]);
  });

  it("returns results sorted ascending regardless of input order", () => {
    const candles = [candle(10), candle(0), candle(5)];
    const visible = visibleCandles(candles, DAY_START + 100 * MIN, "5m");
    expect(visible.map((c) => c.timestamp)).toEqual([DAY_START, DAY_START + 5 * MIN, DAY_START + 10 * MIN]);
  });

  it("an empty candle list is always safely visible-empty", () => {
    expect(visibleCandles([], DAY_START + 1000, "5m")).toEqual([]);
  });
});

describe("buildHigherTimeframeView — higher-timeframe future-leakage prevention (§17)", () => {
  it("EXACT SCENARIO FROM THE SPEC: at replayTime 10:30, the 10:00-11:00 1h candle must not be fully revealed", () => {
    // Base 1m candles for the whole 10:00-11:00 hour, prices rising steadily —
    // if the full hour leaked, high/close would reflect data through 10:59.
    const base: Candle[] = [];
    for (let m = 0; m < 60; m += 1) {
      const t = Date.UTC(2026, 7, 3, 10, m, 0);
      const price = 100 + m; // strictly increasing — 10:59's price (159) must never appear before it's closed
      base.push({ timestamp: t, open: price, high: price + 0.5, low: price - 0.5, close: price, volume: null });
    }
    const replayTime = Date.UTC(2026, 7, 3, 10, 30, 0);
    const view = buildHigherTimeframeView(base, replayTime, "1m", "1h");

    expect(view.closed).toEqual([]); // the 10:00-11:00 bucket has NOT fully elapsed yet
    expect(view.partial).not.toBeNull();
    // The partial candle must only reflect minutes 0..29 (closed 1m candles by 10:30) — high never reaches the full-hour max (159.5).
    expect(view.partial!.high).toBeLessThan(130);
    expect(view.partial!.close).toBe(129); // close of the 10:29 1m candle (last one closed by 10:30)
  });

  it("once the higher-timeframe bucket fully elapses, it moves from partial to closed with the complete OHLC", () => {
    const base: Candle[] = [];
    for (let m = 0; m < 60; m += 1) {
      const t = Date.UTC(2026, 7, 3, 10, m, 0);
      const price = 100 + m;
      base.push({ timestamp: t, open: price, high: price + 0.5, low: price - 0.5, close: price, volume: null });
    }
    const replayTime = Date.UTC(2026, 7, 3, 11, 0, 0); // exactly on the hour — the bucket has closed
    const view = buildHigherTimeframeView(base, replayTime, "1m", "1h");

    expect(view.partial).toBeNull();
    expect(view.closed).toHaveLength(1);
    expect(view.closed[0].open).toBe(100);
    expect(view.closed[0].close).toBe(159); // the 10:59 candle's close, now legitimately visible
    expect(view.closed[0].high).toBe(159.5);
  });

  it("same-timeframe request is just visibleCandles with no partial", () => {
    const base = [candle(0), candle(5)];
    const view = buildHigherTimeframeView(base, DAY_START + 100 * MIN, "5m", "5m");
    expect(view.partial).toBeNull();
    expect(view.closed).toHaveLength(2);
  });

  it("no partial candle exists before any base data has arrived for the current bucket", () => {
    const view = buildHigherTimeframeView([], DAY_START + 10 * MIN, "1m", "1h");
    expect(view.closed).toEqual([]);
    expect(view.partial).toBeNull();
  });
});
