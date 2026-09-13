import { describe, expect, it } from "vitest";

import {
  TIMEFRAMES,
  TIMEFRAME_MINUTES,
  derivableTimeframes,
  isFinerThan,
  timeframeRank,
  timeframeToMs,
} from "@/domain/market-data/timeframe";

describe("canonical timeframe", () => {
  it("has exactly one representation per timeframe", () => {
    expect(TIMEFRAMES).toEqual(["1m", "5m", "15m", "30m", "1h", "4h", "1D"]);
  });

  it("converts to milliseconds correctly", () => {
    expect(timeframeToMs("1m")).toBe(60_000);
    expect(timeframeToMs("15m")).toBe(15 * 60_000);
    expect(timeframeToMs("1h")).toBe(60 * 60_000);
    expect(timeframeToMs("4h")).toBe(4 * 60 * 60_000);
    expect(timeframeToMs("1D")).toBe(24 * 60 * 60_000);
  });

  it("ranks timeframes by ascending granularity", () => {
    expect(timeframeRank("1m")).toBeLessThan(timeframeRank("5m"));
    expect(timeframeRank("1h")).toBeLessThan(timeframeRank("4h"));
    expect(timeframeRank("4h")).toBeLessThan(timeframeRank("1D"));
  });

  it("isFinerThan is consistent with TIMEFRAME_MINUTES", () => {
    expect(isFinerThan("5m", "1h")).toBe(true);
    expect(isFinerThan("1h", "5m")).toBe(false);
    expect(isFinerThan("15m", "15m")).toBe(false);
  });

  it("derivableTimeframes returns every strictly coarser timeframe", () => {
    expect(derivableTimeframes("1h")).toEqual(["4h", "1D"]);
    expect(derivableTimeframes("1D")).toEqual([]);
    expect(derivableTimeframes("1m")).toEqual(TIMEFRAMES.slice(1));
  });

  it("every timeframe has a positive minute duration", () => {
    for (const tf of TIMEFRAMES) {
      expect(TIMEFRAME_MINUTES[tf]).toBeGreaterThan(0);
    }
  });
});
