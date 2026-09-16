import { describe, expect, it } from "vitest";

import { planCandleUpdate } from "@/domain/market-data/chart-update-plan";
import type { Candle } from "@/domain/market-data/candle";

const MIN = 60_000;

function candle(timestamp: number, close = 100): Candle {
  return { timestamp, open: close, high: close, low: close, close, volume: null };
}

describe("planCandleUpdate — Stage 21.1 §16 chart update decision logic", () => {
  it("returns NONE for two empty arrays", () => {
    expect(planCandleUpdate([], [])).toEqual({ type: "none" });
  });

  it("returns NONE when nothing changed (the common mid-bucket tick case)", () => {
    const prev = [candle(0), candle(MIN), candle(2 * MIN)];
    const next = [candle(0), candle(MIN), candle(2 * MIN)];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "none" });
  });

  it("returns APPEND when exactly one new candle is added at the end, unchanged before it", () => {
    const prev = [candle(0), candle(MIN)];
    const appended = candle(2 * MIN, 105);
    const next = [...prev, appended];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "append", bar: appended });
  });

  it("returns REPLACE for the very first candle appearing (empty -> one candle) — first paint is always a full setData", () => {
    const bar = candle(0);
    expect(planCandleUpdate([], [bar])).toEqual({ type: "replace" });
  });

  it("returns REPLACE when the last candle's OHLC changed even though the count is the same (a background chunk revised it)", () => {
    const prev = [candle(0), candle(MIN, 100)];
    const next = [candle(0), candle(MIN, 101)];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "replace" });
  });

  it("returns REPLACE when the array shrinks (asset/timeframe switch)", () => {
    const prev = [candle(0), candle(MIN), candle(2 * MIN)];
    const next = [candle(0)];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "replace" });
  });

  it("returns REPLACE when more than one candle was appended at once (e.g. a background fetch filled a gap)", () => {
    const prev = [candle(0)];
    const next = [candle(0), candle(MIN), candle(2 * MIN)];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "replace" });
  });

  it("returns REPLACE when the first candle's timestamp changed (e.g. a background chunk prepended earlier history)", () => {
    const prev = [candle(MIN), candle(2 * MIN)];
    const next = [candle(0), candle(MIN), candle(2 * MIN)];
    expect(planCandleUpdate(prev, next)).toEqual({ type: "replace" });
  });
});
