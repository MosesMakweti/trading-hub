import { describe, expect, it } from "vitest";

import { PLAYBACK_SPEEDS_MS, PLAYBACK_TIMEFRAMES } from "./workspace";
import { clampSpeed, formatSpeed, intervalAvailable, PLAYBACK_INTERVALS, positionToSpeed, speedToPosition, SPEED_STOPS_MS } from "./playback-speed";

describe("speed slider scale", () => {
  it("every stop round-trips and the scale is strictly increasing", () => {
    SPEED_STOPS_MS.forEach((ms, i) => {
      expect(speedToPosition(ms)).toBe(i);
      expect(positionToSpeed(i)).toBe(ms);
      if (i) expect(ms).toBeGreaterThan(SPEED_STOPS_MS[i - 1]);
    });
  });

  it("offers every preset as an exact stop, and snaps custom values to the nearest stop (log scale)", () => {
    for (const p of PLAYBACK_SPEEDS_MS) expect(positionToSpeed(speedToPosition(p))).toBe(p);
    expect(positionToSpeed(speedToPosition(480))).toBe(500);
    expect(positionToSpeed(speedToPosition(1_100))).toBe(1000);
    expect(positionToSpeed(speedToPosition(1))).toBe(5); // clamped
    expect(positionToSpeed(99)).toBe(60_000);
  });

  it("formats speeds readably and clamps custom input to safe limits", () => {
    expect(formatSpeed(500)).toBe("500 ms");
    expect(formatSpeed(1000)).toBe("1 s");
    expect(formatSpeed(1500)).toBe("1.5 s");
    expect(formatSpeed(60_000)).toBe("1 min");
    expect(clampSpeed(1)).toBe(5);
    expect(clampSpeed(10)).toBe(10);
    expect(clampSpeed(999_999)).toBe(60_000);
  });
});

describe("playback intervals follow the data's resolution", () => {
  it("with 1-minute data: seconds are unavailable, every minute/hour interval is, and maps to a playback timeframe", () => {
    const avail = PLAYBACK_INTERVALS.filter((i) => intervalAvailable(i, 60));
    expect(avail.map((i) => i.timeframe)).toEqual([...PLAYBACK_TIMEFRAMES]);
    expect(PLAYBACK_INTERVALS.filter((i) => i.seconds < 60).every((i) => !intervalAvailable(i, 60))).toBe(true);
  });
});
