import { describe, expect, it } from "vitest";

import { fixedOffsetWallClockToUtc, isValidIanaTimeZone, localWallClockToUtc } from "@/lib/timezone";

describe("localWallClockToUtc", () => {
  it("converts a UTC+2 wall-clock instant to the correct UTC instant", () => {
    // 2026-08-03 15:00 in "Etc/GMT-2" (POSIX-inverted: GMT-2 means UTC+2) = 13:00 UTC.
    const result = localWallClockToUtc(2026, 8, 3, 15, 0, 0, "Etc/GMT-2");
    expect(result.getTime()).toBe(Date.UTC(2026, 7, 3, 13, 0, 0));
  });

  it("is DST-aware for a real IANA zone across a known transition", () => {
    // US DST ended 2025-11-02. Before: UTC-4 (EDT). After: UTC-5 (EST).
    const beforeFallBack = localWallClockToUtc(2025, 11, 1, 12, 0, 0, "America/New_York");
    const afterFallBack = localWallClockToUtc(2025, 11, 3, 12, 0, 0, "America/New_York");
    expect(beforeFallBack.getTime()).toBe(Date.UTC(2025, 10, 1, 16, 0, 0)); // UTC-4
    expect(afterFallBack.getTime()).toBe(Date.UTC(2025, 10, 3, 17, 0, 0)); // UTC-5
  });
});

describe("fixedOffsetWallClockToUtc", () => {
  it("applies a fixed positive offset with no DST/Intl lookup", () => {
    const result = fixedOffsetWallClockToUtc(2026, 8, 3, 15, 0, 0, 180); // UTC+3
    expect(result.getTime()).toBe(Date.UTC(2026, 7, 3, 12, 0, 0));
  });

  it("applies a fixed negative offset", () => {
    const result = fixedOffsetWallClockToUtc(2026, 8, 3, 8, 0, 0, -300); // UTC-5
    expect(result.getTime()).toBe(Date.UTC(2026, 7, 3, 13, 0, 0));
  });

  it("never varies across the year (no DST) — unlike an IANA zone that observes it", () => {
    const winter = fixedOffsetWallClockToUtc(2026, 1, 3, 12, 0, 0, 120);
    const summer = fixedOffsetWallClockToUtc(2026, 7, 3, 12, 0, 0, 120);
    expect(winter.getTime() - Date.UTC(2026, 0, 3, 10, 0, 0)).toBe(0);
    expect(summer.getTime() - Date.UTC(2026, 6, 3, 10, 0, 0)).toBe(0);
  });
});

describe("isValidIanaTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidIanaTimeZone("Europe/London")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects a made-up zone name", () => {
    expect(isValidIanaTimeZone("Not/A_Real_Zone")).toBe(false);
  });
});
