import { describe, expect, it } from "vitest";

import {
  breakNoticeText,
  formatDuration,
  formatLocalTime,
  minutesUntil,
  pendingContext,
  scoredSummary,
  signedDeviation,
  streakDays,
  timingPhrase,
  weekdaysSummary,
} from "@/lib/preparation-format";
import type { PreparationTodayDTO } from "@/types/preparation";

type Scored = Extract<PreparationTodayDTO, { kind: "SCORED" }>;
const scored = (over: Partial<Scored>): Scored => ({
  kind: "SCORED",
  status: "ON_TIME",
  score: 100,
  completionPoints: 70,
  timingPoints: 30,
  completionMax: 70,
  timingMax: 30,
  requiredTotal: 4,
  requiredDone: 4,
  targetAt: "2026-10-05T12:00:00.000Z",
  cutoffAt: "2026-10-05T18:00:00.000Z",
  readyAt: "2026-10-05T12:00:00.000Z",
  deviationMinutes: 0,
  bandLabel: "On time",
  corrected: null,
  ...over,
});

describe("timing language", () => {
  it("durations are concise and never signed", () => {
    expect([formatDuration(17), formatDuration(-12), formatDuration(60), formatDuration(74), formatDuration(-185)]).toEqual([
      "17 min",
      "12 min",
      "1h",
      "1h 14m",
      "3h 5m",
    ]);
  });

  it("phrases come from the canonical status and rounded deviation", () => {
    expect(timingPhrase("ON_TIME", -12)).toBe("On time");
    expect(timingPhrase("EARLY", -75)).toBe("1h 15m early");
    expect(timingPhrase("LATE", 17)).toBe("17 min late");
    expect(timingPhrase("VERY_LATE", 74)).toBe("1h 14m late");
    expect(timingPhrase("VERY_EARLY", -400)).toBe("Very early");
    expect(timingPhrase("INCOMPLETE", null)).toBe("Missed cutoff");
    expect(timingPhrase("MISSED", null)).toBe("Missed");
    expect([signedDeviation(17), signedDeviation(-12), signedDeviation(0)]).toEqual(["+17 min", "−12 min", "0 min"]);
  });

  it("pending context counts toward / past the target", () => {
    expect([pendingContext(25), pendingContext(0), pendingContext(-12), pendingContext(-74)]).toEqual([
      "25 min remaining",
      "Target time",
      "12 min late",
      "1h 14m late",
    ]);
    expect(minutesUntil("2026-10-05T12:00:00.000Z", Date.parse("2026-10-05T11:35:30.000Z"))).toBe(25);
  });
});

describe("score summaries", () => {
  it("100/100, late, incomplete and missed", () => {
    expect(scoredSummary(scored({}))).toBe("On time · Routine complete");
    expect(scoredSummary(scored({ status: "LATE", score: 95, timingPoints: 25, deviationMinutes: 17 }))).toBe("Routine complete · 17 min late");
    expect(scoredSummary(scored({ status: "INCOMPLETE", score: 35, completionPoints: 35, timingPoints: 0, requiredDone: 2, readyAt: null, deviationMinutes: null }))).toBe(
      "2 of 4 required · Missed cutoff",
    );
    expect(scoredSummary(scored({ status: "MISSED", score: 0, completionPoints: 0, timingPoints: 0, requiredDone: 0, readyAt: null, deviationMinutes: null }))).toBe(
      "Pre-session routine missed",
    );
  });

  it("a correction's status takes precedence in the wording", () => {
    expect(scoredSummary(scored({ status: "MISSED", score: 0, corrected: { status: "ON_TIME", score: 100 } }))).toBe("On time · Routine complete");
  });
});

describe("timezone formatting", () => {
  it("shows instants in the schedule's zone, never the runtime's", () => {
    const iso = "2026-10-05T12:17:00.000Z";
    expect(formatLocalTime(iso, "America/New_York")).toBe("08:17");
    expect(formatLocalTime(iso, "Europe/London")).toBe("13:17");
    expect(formatLocalTime(iso, "Asia/Tokyo")).toBe("21:17");
    // DST: the same 08:00 New York target maps to different UTC instants, same label.
    expect(formatLocalTime("2026-12-07T13:00:00.000Z", "America/New_York")).toBe("08:00");
  });

  it("weekday summaries", () => {
    expect(weekdaysSummary([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(weekdaysSummary([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(weekdaysSummary([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(weekdaysSummary([6, 0])).toBe("Sat, Sun");
    expect(weekdaysSummary([0, 1, 2, 3, 4])).toBe("Mon, Tue, Wed, Thu, Sun");
  });
});

describe("streak wording", () => {
  it("break notice is factual and names the day", () => {
    const n = { recordId: "r", dateKey: "2026-10-05", status: "MISSED" as const, endedLength: 14, longest: 23 };
    expect(breakNoticeText(n, "2026-10-07")).toEqual({
      headline: "Your 14-day Preparation Streak ended",
      detail: "Monday's pre-session routine wasn't completed.",
      best: "Best streak: 23 days",
    });
    expect(breakNoticeText({ ...n, status: "INCOMPLETE" }, "2026-10-06").detail).toBe("Yesterday's pre-session routine wasn't completed before the cutoff.");
    expect(breakNoticeText(n, "2026-10-20").detail).toBe("The Oct 5 pre-session routine wasn't completed.");
    const text = JSON.stringify(breakNoticeText(n, "2026-10-07")).toLowerCase();
    for (const word of ["fail", "undisciplined", "bad"]) expect(text).not.toContain(word);
    expect([streakDays(1), streakDays(14)]).toEqual(["1 scheduled trading day", "14 scheduled trading days"]);
  });
});
