import { describe, expect, it } from "vitest";

import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import type { Candle } from "@/domain/market-data/candle";

const MIN = 60_000;
const DAY_MS = 86_400_000;
// A Monday — so a "no gap" 1m range never accidentally straddles a weekend.
const MONDAY = Date.UTC(2026, 7, 3, 0, 0, 0);
// A Friday, for weekend-gap classification tests.
const FRIDAY = Date.UTC(2026, 7, 7, 0, 0, 0);

function candle(ms: number, close = 100): Candle {
  return { timestamp: ms, open: close, high: close + 0.5, low: close - 0.5, close, volume: null };
}

describe("analyzeMarketDataQuality — Stage 21.2 §17 deterministic metrics", () => {
  it("reports 100% coverage and zero anomalies for a perfectly complete, ordered, deduped range", () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(MONDAY + i * MIN));
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 9 * MIN);
    expect(report.expectedIntervals).toBe(10);
    expect(report.actualCandles).toBe(10);
    expect(report.duplicateCount).toBe(0);
    expect(report.outOfOrderCount).toBe(0);
    expect(report.invalidCandleCount).toBe(0);
    expect(report.syntheticCandleCount).toBe(0);
    expect(report.missingIntervals).toEqual([]);
    expect(report.coveragePercent).toBe(100);
  });

  it("counts exact-timestamp duplicates in the raw input without double-counting them as actual candles", () => {
    const candles = [candle(MONDAY), candle(MONDAY), candle(MONDAY + MIN)];
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + MIN);
    expect(report.duplicateCount).toBe(1);
    expect(report.actualCandles).toBe(2);
  });

  it("counts out-of-order adjacent pairs in the ORIGINAL input order", () => {
    const candles = [candle(MONDAY + 2 * MIN), candle(MONDAY), candle(MONDAY + MIN)]; // one inversion: index0 -> index1 decreases
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 2 * MIN);
    expect(report.outOfOrderCount).toBe(1);
    // Still correctly sorted/deduped for the actual count regardless of input order.
    expect(report.actualCandles).toBe(3);
  });

  it("flags an invalid OHLC candle and excludes it from actualCandles/gap computation", () => {
    const bad: Candle = { timestamp: MONDAY + MIN, open: 100, high: 90, low: 95, close: 100, volume: null }; // high < low
    const candles = [candle(MONDAY), bad, candle(MONDAY + 2 * MIN)];
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 2 * MIN);
    expect(report.invalidCandleCount).toBe(1);
    expect(report.actualCandles).toBe(2);
    // The invalid candle's slot is now correctly reported as missing, not silently ignored.
    expect(report.missingIntervals).toHaveLength(1);
    expect(report.missingIntervals[0].from).toBe(MONDAY + MIN);
  });

  it("detects a missing interval in the middle of the range and classifies it UNEXPECTED on a weekday", () => {
    const candles = [candle(MONDAY), candle(MONDAY + 3 * MIN)]; // minutes 1 and 2 missing
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 3 * MIN);
    expect(report.missingIntervals).toEqual([{ from: MONDAY + MIN, to: MONDAY + 2 * MIN, count: 2, classification: "UNEXPECTED" }]);
    expect(report.longestUnexpectedGapIntervals).toBe(2);
  });

  it("detects a trailing gap when the range ends after the last candle", () => {
    const candles = [candle(MONDAY)];
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 2 * MIN);
    expect(report.missingIntervals).toEqual([{ from: MONDAY + MIN, to: MONDAY + 2 * MIN, count: 2, classification: "UNEXPECTED" }]);
  });

  it("classifies a gap spanning an entire UTC weekend as WEEKEND, not UNEXPECTED", () => {
    // Friday 23:59 candle, next candle Monday 00:00 — every missing minute in between is Sat/Sun.
    const fridayClose = FRIDAY + 23 * 60 * MIN + 59 * MIN;
    const mondayOpen = FRIDAY + 3 * DAY_MS;
    const candles = [candle(fridayClose), candle(mondayOpen)];
    const report = analyzeMarketDataQuality(candles, "1m", fridayClose, mondayOpen);
    expect(report.missingIntervals[0].classification).toBe("WEEKEND");
  });

  it("does NOT classify a gap as WEEKEND if any part of it falls on a weekday (a real Friday-into-Monday provider gap must not hide inside a weekend label)", () => {
    // Starts mid-Friday (a weekday) through the weekend — must be UNEXPECTED overall.
    const thursdayEvening = FRIDAY - 2 * MIN;
    const mondayMorning = FRIDAY + 3 * DAY_MS;
    const candles = [candle(thursdayEvening), candle(mondayMorning)];
    const report = analyzeMarketDataQuality(candles, "1m", thursdayEvening, mondayMorning);
    expect(report.missingIntervals[0].classification).toBe("UNEXPECTED");
  });

  it("computes coveragePercent as a plain ratio, unaffected by gap classification", () => {
    const candles = [candle(MONDAY), candle(MONDAY + MIN), candle(MONDAY + 2 * MIN), candle(MONDAY + 3 * MIN)];
    // 4 of 10 expected minutes present.
    const report = analyzeMarketDataQuality(candles, "1m", MONDAY, MONDAY + 9 * MIN);
    expect(report.coveragePercent).toBe(40);
  });

  it("never reports synthetic candles — always exactly 0, since no fabrication logic exists in this codebase", () => {
    const report = analyzeMarketDataQuality([], "1m", MONDAY, MONDAY + 9 * MIN);
    expect(report.syntheticCandleCount).toBe(0);
  });

  it("handles a completely empty input safely", () => {
    const report = analyzeMarketDataQuality([], "1m", MONDAY, MONDAY + 9 * MIN);
    expect(report.actualCandles).toBe(0);
    expect(report.coveragePercent).toBe(0);
    expect(report.missingIntervals).toHaveLength(1);
    expect(report.missingIntervals[0].count).toBe(10);
  });
});
