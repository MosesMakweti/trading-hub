import { describe, expect, it } from "vitest";

import { buildHigherTimeframeView, visibleCandles } from "@/domain/market-data/visible-candles";
import { TIMEFRAMES, timeframeToMs } from "@/domain/market-data/timeframe";
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

describe("visibleCandles — exact-boundary proof for EVERY canonical timeframe (Stage 21.2 §13)", () => {
  for (const tf of TIMEFRAMES) {
    it(`${tf}: hidden 1ms before close, visible at exact close`, () => {
      const c: Candle = { timestamp: DAY_START, open: 100, high: 101, low: 99, close: 100, volume: null };
      const closeTime = DAY_START + timeframeToMs(tf);
      expect(visibleCandles([c], closeTime - 1, tf)).toHaveLength(0);
      expect(visibleCandles([c], closeTime, tf)).toHaveLength(1);
    });
  }
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

describe("chart-vs-execution consistency (Stage 21.2 §14-15) — both consumers must read the SAME canonical facts", () => {
  it("the chart's last closed display-timeframe candle is built from EXACTLY the 1m candles the execution engine would also see, never a different or leaked set", () => {
    // One hour of 1m base candles, strictly increasing price.
    const base: Candle[] = [];
    for (let m = 0; m < 60; m += 1) {
      const t = Date.UTC(2026, 7, 3, 9, m, 0);
      const price = 100 + m;
      base.push({ timestamp: t, open: price, high: price + 0.5, low: price - 0.5, close: price, volume: null });
    }
    const replayTime = Date.UTC(2026, 7, 3, 9, 15, 0); // exactly closes the 09:00-09:15 15m bucket

    // Execution's own data source (replay-market-panel.tsx's advanceExecutionIfNeeded): 1m base, no-hindsight-filtered.
    const executionFeed = visibleCandles(base, replayTime, "1m");
    // The chart's own data source at a 15m display timeframe.
    const chartView = buildHigherTimeframeView(base, replayTime, "1m", "15m");

    expect(executionFeed).toHaveLength(15); // exactly the 09:00..09:14 1m candles
    expect(chartView.closed).toHaveLength(1); // exactly the one now-closed 09:00-09:15 15m candle
    // The displayed 15m candle's OHLC must be EXACTLY the aggregation of the
    // SAME 15 one-minute candles the execution engine independently reads —
    // proving the two consumers can never diverge, since both are pure
    // functions of the identical `base` array.
    const displayed = chartView.closed[0];
    expect(displayed.open).toBe(executionFeed[0].open);
    expect(displayed.close).toBe(executionFeed[executionFeed.length - 1].close);
    expect(displayed.high).toBe(Math.max(...executionFeed.map((c) => c.high)));
    expect(displayed.low).toBe(Math.min(...executionFeed.map((c) => c.low)));
  });
});

describe("prefetch never leaks future data (Stage 17B.1 §13) — download-ahead is fine, reveal-ahead is not", () => {
  const DAY_MS = 1440 * MIN;

  it("candles for days already downloaded past the Clock are entirely absent from what's visible", () => {
    // Simulate the WHOLE multi-day review period already sitting in memory
    // (background prefetch has finished, or even raced ahead) — this is
    // exactly the shape `baseCandlesByAsset` takes in replay-market-panel.tsx
    // once prefetch has run. Three days of 1m candles, all already "loaded."
    const wholePeriod: Candle[] = [];
    for (let day = 0; day < 3; day += 1) {
      for (let m = 0; m < 1440; m += 1) {
        wholePeriod.push(candle(day * 1440 + m, 100 + day * 1000 + m));
      }
    }
    // Replay Clock sits early on day 0 — day 1 and day 2 are fully "in the future" from the trader's vantage point.
    const replayTime = DAY_START + 5 * MIN;
    const visible = visibleCandles(wholePeriod, replayTime, "1m");

    expect(visible).toHaveLength(5); // only :00,:01,:02,:03,:04 of day 0 have closed by 00:05
    expect(visible.every((c) => c.timestamp < DAY_START + DAY_MS)).toBe(true); // not one candle from day 1/2 leaks through
    expect(visible[visible.length - 1].timestamp + MIN).toBeLessThanOrEqual(replayTime);
  });

  it("the same downstream filter execution reads from (watermark-bounded visibleCandles) never exposes a next-day candle at a day boundary", () => {
    // Mirrors replay-market-panel.tsx's advanceExecutionIfNeeded: candles
    // strictly after a watermark, intersected with visibleCandles(newTime).
    const wholePeriod: Candle[] = [candle(1438, 500), candle(1439, 501), candle(1440, 502), candle(1441, 503)]; // last two are day 1, 00:00/00:01
    const watermark = DAY_START + 1437 * MIN;
    const replayTime = DAY_START + 1440 * MIN; // exactly midnight — day 1's 00:00 candle has NOT closed yet (closes at 00:01)
    const executionFeed = visibleCandles(wholePeriod, replayTime, "1m").filter((c) => c.timestamp > watermark);
    expect(executionFeed.map((c) => c.timestamp)).toEqual([DAY_START + 1438 * MIN, DAY_START + 1439 * MIN]);
    expect(executionFeed.some((c) => c.timestamp >= DAY_START + 1440 * MIN)).toBe(false);
  });
});
