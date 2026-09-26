import { describe, expect, it } from "vitest";

import { bucketEnd, bucketStart, bucketStartBefore, REPLAY_TIMEFRAMES, type ReplayTimeframe } from "./timeframes";
import { formatWallClock, parseWallClock, wallClockMinuteOf, weekdayOf } from "./wall-clock";
import { wc } from "./testing/m1-fixtures";

const bucket = (t: string, tf: ReplayTimeframe) => {
  const s = bucketStart(wc(t), tf);
  return `${formatWallClock(s)} → ${formatWallClock(bucketEnd(s, tf) - 1)}`;
};

describe("wall clock", () => {
  it("round-trips and rejects impossible dates instead of rolling them over", () => {
    expect(formatWallClock(wc("2024-05-14T09:37"))).toBe("2024-05-14T09:37");
    expect(wallClockMinuteOf(2024, 2, 29, 0, 0)).not.toBeNull(); // leap day
    expect(wallClockMinuteOf(2023, 2, 29, 0, 0)).toBeNull();
    expect(wallClockMinuteOf(2024, 4, 31, 0, 0)).toBeNull();
    expect(wallClockMinuteOf(2024, 13, 1, 0, 0)).toBeNull();
    expect(wallClockMinuteOf(2024, 1, 1, 24, 0)).toBeNull();
    expect(parseWallClock("2024-05-14T09:37Z")).toBeNull(); // not an instant
  });

  it("weekday is computed on the dataset clock", () => {
    expect(weekdayOf(wc("2024-05-12T00:00"))).toBe(0); // Sunday
    expect(weekdayOf(wc("2024-05-18T23:59"))).toBe(6); // Saturday
  });
});

describe("candle boundaries (dataset/server wall clock)", () => {
  it("intraday buckets are midnight-anchored multiples", () => {
    expect(bucket("2024-05-14T09:07", "M5")).toBe("2024-05-14T09:05 → 2024-05-14T09:09");
    expect(bucket("2024-05-14T09:14", "M15")).toBe("2024-05-14T09:00 → 2024-05-14T09:14");
    expect(bucket("2024-05-14T09:15", "M15")).toBe("2024-05-14T09:15 → 2024-05-14T09:29");
    expect(bucket("2024-05-14T09:29", "M30")).toBe("2024-05-14T09:00 → 2024-05-14T09:29");
    expect(bucket("2024-05-14T09:30", "M30")).toBe("2024-05-14T09:30 → 2024-05-14T09:59");
    expect(bucket("2024-05-14T09:59", "H1")).toBe("2024-05-14T09:00 → 2024-05-14T09:59");
    expect(bucket("2024-05-14T09:59", "H2")).toBe("2024-05-14T08:00 → 2024-05-14T09:59");
    expect(bucket("2024-05-14T03:59", "H4")).toBe("2024-05-14T00:00 → 2024-05-14T03:59");
    expect(bucket("2024-05-14T04:00", "H4")).toBe("2024-05-14T04:00 → 2024-05-14T07:59");
    expect(bucket("2024-05-14T23:59", "H4")).toBe("2024-05-14T20:00 → 2024-05-14T23:59");
    expect(bucket("2024-05-14T13:00", "H6")).toBe("2024-05-14T12:00 → 2024-05-14T17:59");
    expect(bucket("2024-05-14T15:59", "H8")).toBe("2024-05-14T08:00 → 2024-05-14T15:59");
    expect(bucket("2024-05-14T12:00", "H12")).toBe("2024-05-14T12:00 → 2024-05-14T23:59");
  });

  it("D1 is the server calendar day", () => {
    expect(bucket("2024-05-14T23:59", "D1")).toBe("2024-05-14T00:00 → 2024-05-14T23:59");
    expect(bucket("2024-05-15T00:00", "D1")).toBe("2024-05-15T00:00 → 2024-05-15T23:59");
  });

  it("W1 starts Sunday 00:00 server time (MT5 convention)", () => {
    expect(bucket("2024-05-12T00:00", "W1")).toBe("2024-05-12T00:00 → 2024-05-18T23:59"); // Sunday
    expect(bucket("2024-05-17T23:59", "W1")).toBe("2024-05-12T00:00 → 2024-05-18T23:59"); // Friday
    expect(bucket("2024-05-11T23:59", "W1")).toBe("2024-05-05T00:00 → 2024-05-11T23:59"); // Saturday → previous week
    expect(bucket("2024-01-01T10:00", "W1")).toBe("2023-12-31T00:00 → 2024-01-06T23:59"); // across the year
  });

  it("MN1 follows calendar months: Jan→Feb, leap February, Dec→Jan", () => {
    expect(bucket("2024-01-31T23:59", "MN1")).toBe("2024-01-01T00:00 → 2024-01-31T23:59");
    expect(bucket("2024-02-01T00:00", "MN1")).toBe("2024-02-01T00:00 → 2024-02-29T23:59");
    expect(bucket("2023-02-15T12:00", "MN1")).toBe("2023-02-01T00:00 → 2023-02-28T23:59");
    expect(bucket("2023-12-31T23:59", "MN1")).toBe("2023-12-01T00:00 → 2023-12-31T23:59");
    expect(bucket("2024-01-01T00:00", "MN1")).toBe("2024-01-01T00:00 → 2024-01-31T23:59");
  });

  it("bucketStartBefore steps back whole buckets (calendar-aware for MN1)", () => {
    expect(formatWallClock(bucketStartBefore(wc("2024-03-01T00:00"), "MN1", 2))).toBe("2024-01-01T00:00");
    expect(formatWallClock(bucketStartBefore(wc("2024-01-01T00:00"), "MN1", 1))).toBe("2023-12-01T00:00");
    expect(formatWallClock(bucketStartBefore(wc("2024-05-14T09:00"), "H1", 3))).toBe("2024-05-14T06:00");
  });

  it("every bucket contains its own start and every minute maps into exactly one bucket", () => {
    for (const tf of REPLAY_TIMEFRAMES) {
      for (const t of ["2024-02-29T23:59", "2024-03-03T00:00", "2024-12-31T23:59", "2024-05-14T09:37"]) {
        const m = wc(t);
        const s = bucketStart(m, tf);
        expect(s <= m && m < bucketEnd(s, tf)).toBe(true);
        expect(bucketStart(s, tf)).toBe(s);
        expect(bucketStart(bucketEnd(s, tf), tf)).toBe(bucketEnd(s, tf));
      }
    }
  });
});
