import { describe, expect, it } from "vitest";

import {
  computeRunProgress,
  firstTradingDayKey,
  isBacktestDayComplete,
  isTradingDay,
  isWithinRun,
  listTradingDayKeys,
  nextTradingDayKey,
  normalizeSessionDateKey,
  previousTradingDayKey,
  resumeDateKey,
  type RunPeriod,
} from "./run-calendar";

// May 2024: Wed 1st … Fri 31st. 14th is a Tuesday; 18th/19th a weekend.
const may: RunPeriod = { startDateKey: "2024-05-01", endDateKey: "2024-05-31", tradingWeekdays: [1, 2, 3, 4, 5] };

describe("run calendar", () => {
  it("counts only configured weekdays as trading days", () => {
    expect(listTradingDayKeys(may)).toHaveLength(23);
    expect(isTradingDay(may, "2024-05-14")).toBe(true);
    expect(isTradingDay(may, "2024-05-18")).toBe(false);
  });

  it("honours a custom weekday set (e.g. Sunday futures open)", () => {
    expect(listTradingDayKeys({ ...may, tradingWeekdays: [0, 1, 2, 3, 4, 5] })).toHaveLength(27);
  });

  it("navigates across weekends and stops at the run boundary", () => {
    expect(nextTradingDayKey(may, "2024-05-17")).toBe("2024-05-20");
    expect(previousTradingDayKey(may, "2024-05-20")).toBe("2024-05-17");
    expect(nextTradingDayKey(may, "2024-05-31")).toBeNull();
    expect(previousTradingDayKey(may, "2024-05-01")).toBeNull();
  });

  it("bounds membership to the inclusive period", () => {
    expect(isWithinRun(may, "2024-05-01")).toBe(true);
    expect(isWithinRun(may, "2024-05-31")).toBe(true);
    expect(isWithinRun(may, "2024-06-01")).toBe(false);
    expect(isWithinRun(may, "2024-02-30")).toBe(false);
  });

  it("starts on the first trading day when the period opens on a weekend", () => {
    expect(firstTradingDayKey({ ...may, startDateKey: "2024-05-04" })).toBe("2024-05-06");
  });

  it("resumes on the unfinished day, or the next trading day after a completed one", () => {
    expect(resumeDateKey(may, null, false)).toBe("2024-05-01");
    expect(resumeDateKey(may, "2024-05-14", false)).toBe("2024-05-14");
    expect(resumeDateKey(may, "2024-05-17", true)).toBe("2024-05-20");
    expect(resumeDateKey(may, "2024-05-31", true)).toBe("2024-05-31");
    expect(resumeDateKey(may, "2023-01-01", true)).toBe("2024-05-01");
  });

  it("progress ignores weekends and out-of-range days instead of diluting the ratio", () => {
    const progress = computeRunProgress(may, ["2024-05-13", "2024-05-14", "2024-05-14", "2024-05-18", "2024-06-03"]);
    expect(progress.totalTradingDays).toBe(23);
    expect(progress.completedTradingDays).toBe(2);
    expect(progress.completedNonTradingDays).toBe(1);
    expect(progress.percentComplete).toBeCloseTo((2 / 23) * 100);
  });
});

describe("session date normalization + completion", () => {
  it("honours an in-range trading day", () => {
    expect(normalizeSessionDateKey(may, "2024-05-14", "2024-05-01")).toBe("2024-05-14");
  });
  it("moves a weekend to the next trading day, or the previous one at the run's end", () => {
    expect(normalizeSessionDateKey(may, "2024-05-18", "2024-05-01")).toBe("2024-05-20");
    const endsSaturday = { ...may, endDateKey: "2024-05-25" };
    expect(normalizeSessionDateKey(endsSaturday, "2024-05-25", "2024-05-01")).toBe("2024-05-24");
  });
  it("falls back to the resume position for missing, malformed or out-of-range dates", () => {
    expect(normalizeSessionDateKey(may, null, "2024-05-09")).toBe("2024-05-09");
    expect(normalizeSessionDateKey(may, "garbage", "2024-05-09")).toBe("2024-05-09");
    expect(normalizeSessionDateKey(may, "2024-07-01", "2024-05-09")).toBe("2024-05-09");
  });
  it("a day is complete only once closed (archived), never by visiting or trading it", () => {
    expect(isBacktestDayComplete(null)).toBe(false);
    expect(isBacktestDayComplete({ status: "ACTIVE" })).toBe(false);
    expect(isBacktestDayComplete({ status: "ARCHIVED" })).toBe(true);
  });
});
