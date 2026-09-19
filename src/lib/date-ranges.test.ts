import { describe, expect, it } from "vitest";

import { daysBetweenInclusive, presetToRange } from "./date-ranges";

describe("presetToRange", () => {
  const today = new Date(2026, 6, 15); // July 15, 2026 (local)

  it("computes a 7-day window for 'week'", () => {
    const range = presetToRange("week", today);
    expect(range).toEqual({ from: "2026-07-09", to: "2026-07-15" });
  });

  it("computes a 1-month window for 'month'", () => {
    const range = presetToRange("month", today);
    expect(range).toEqual({ from: "2026-06-15", to: "2026-07-15" });
  });

  it("computes a 1-year window for 'year'", () => {
    const range = presetToRange("year", today);
    expect(range).toEqual({ from: "2025-07-15", to: "2026-07-15" });
  });

  // Analytics V2 §18 — the requested preset set: 7D/30D/90D/YTD/1Y/ALL/Custom.
  it("computes a year-to-date window for 'ytd'", () => {
    const range = presetToRange("ytd", today);
    expect(range).toEqual({ from: "2026-01-01", to: "2026-07-15" });
  });

  it("computes an all-time sentinel window for 'all'", () => {
    const range = presetToRange("all", today);
    expect(range).toEqual({ from: "2000-01-01", to: "2026-07-15" });
  });
});

describe("daysBetweenInclusive", () => {
  it("counts both endpoints", () => {
    expect(daysBetweenInclusive("2026-07-01", "2026-07-07")).toBe(7);
    expect(daysBetweenInclusive("2026-07-01", "2026-07-01")).toBe(1);
  });
});
