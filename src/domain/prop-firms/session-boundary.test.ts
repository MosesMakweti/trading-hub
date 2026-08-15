import { describe, expect, it } from "vitest";

import { groupByTradingDay, isSameTradingDay, tradingDayKeyFor } from "@/domain/prop-firms/session-boundary";

describe("tradingDayKeyFor", () => {
  it("buckets by plain UTC calendar date when no timezone/reset hour is configured", () => {
    expect(tradingDayKeyFor(new Date("2026-03-05T10:00:00Z"), null, 0)).toBe("2026-03-05");
    expect(tradingDayKeyFor(new Date("2026-03-05T23:59:00Z"), null, 0)).toBe("2026-03-05");
    expect(tradingDayKeyFor(new Date("2026-03-06T00:00:00Z"), null, 0)).toBe("2026-03-06");
  });

  it("respects a non-zero reset hour — an instant just before the reset belongs to the PREVIOUS trading day", () => {
    // Reset at 17:00 UTC: 16:59 is still "yesterday's" trading day, 17:00 starts the next.
    expect(tradingDayKeyFor(new Date("2026-03-05T16:59:00Z"), null, 17)).toBe("2026-03-04");
    expect(tradingDayKeyFor(new Date("2026-03-05T17:00:00Z"), null, 17)).toBe("2026-03-05");
  });

  it("applies a timezone's fixed offset before bucketing", () => {
    // New York is UTC-5 in this fixed-offset model: 2026-03-05T04:00Z is still 2026-03-04 local, before the default UTC-midnight reset.
    expect(tradingDayKeyFor(new Date("2026-03-05T04:00:00Z"), "America/New_York", 0)).toBe("2026-03-04");
    expect(tradingDayKeyFor(new Date("2026-03-05T05:00:00Z"), "America/New_York", 0)).toBe("2026-03-05");
  });

  it("falls back to UTC for an unrecognized timezone rather than throwing", () => {
    expect(tradingDayKeyFor(new Date("2026-03-05T10:00:00Z"), "Not/A_Real_Zone", 0)).toBe("2026-03-05");
  });
});

describe("isSameTradingDay", () => {
  it("is true for two instants either side of local midnight but before the reset boundary", () => {
    const a = new Date("2026-03-05T16:00:00Z");
    const b = new Date("2026-03-05T16:59:00Z");
    expect(isSameTradingDay(a, b, null, 17)).toBe(true);
  });

  it("is false across the reset boundary itself", () => {
    const before = new Date("2026-03-05T16:59:00Z");
    const after = new Date("2026-03-05T17:00:00Z");
    expect(isSameTradingDay(before, after, null, 17)).toBe(false);
  });
});

describe("groupByTradingDay", () => {
  it("groups items into buckets, preserving each bucket's original order", () => {
    const items = [
      { id: "a", at: new Date("2026-03-05T10:00:00Z") },
      { id: "b", at: new Date("2026-03-05T12:00:00Z") },
      { id: "c", at: new Date("2026-03-06T01:00:00Z") },
    ];
    const buckets = groupByTradingDay(items, (i) => i.at, null, 0);
    expect(buckets.size).toBe(2);
    expect(buckets.get("2026-03-05")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(buckets.get("2026-03-06")?.map((i) => i.id)).toEqual(["c"]);
  });
});
