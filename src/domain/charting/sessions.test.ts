import { describe, expect, it } from "vitest";

import { parseWallClock } from "@/domain/native-replay/wall-clock";
import { BUILTIN_SESSIONS, isValidTimeZone, localDateOf, nextOccurrence, occurrenceOn, occurrencesBetween, offsetMinutes, previousOccurrence, type SessionDef } from "./sessions";

const S = (id: string) => BUILTIN_SESSIONS.find((s) => s.id === id)!;
const wc = (s: string) => parseWallClock(s)!;

describe("time zones", () => {
  it("offsets follow each zone's DST calendar; NYC+7 is GMT+2/+3 on US dates", () => {
    expect(offsetMinutes("Europe/London", Date.UTC(2024, 0, 15))).toBe(0);
    expect(offsetMinutes("Europe/London", Date.UTC(2024, 6, 15))).toBe(60);
    expect(offsetMinutes("NYC+7", Date.UTC(2024, 0, 15))).toBe(120);
    expect(offsetMinutes("NYC+7", Date.UTC(2024, 2, 18))).toBe(180); // US already on DST
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("session occurrences", () => {
  it("London 08:00 London time: 08:00/07:00 UTC in winter/summer, always 10:00 on an NYC+7 server", () => {
    expect(occurrenceOn(S("london"), "2024-01-15", "UTC")).toMatchObject({ start: wc("2024-01-15T08:00"), end: wc("2024-01-15T17:00") });
    expect(occurrenceOn(S("london"), "2024-07-15", "UTC")).toMatchObject({ start: wc("2024-07-15T07:00"), end: wc("2024-07-15T16:00") });
    expect(occurrenceOn(S("london"), "2024-01-15", "NYC+7")!.start).toBe(wc("2024-01-15T10:00"));
    expect(occurrenceOn(S("london"), "2024-07-15", "NYC+7")!.start).toBe(wc("2024-07-15T10:00"));
  });

  it("London–NY overlap is the true intersection: 4 h normally, 5 h in the US/UK DST mismatch week", () => {
    const normal = occurrenceOn(S("ldn-ny"), "2024-07-15", "UTC")!;
    expect([normal.start, normal.end]).toEqual([wc("2024-07-15T12:00"), wc("2024-07-15T16:00")]);
    const mismatch = occurrenceOn(S("ldn-ny"), "2024-03-18", "UTC")!;
    expect(mismatch.end - mismatch.start).toBe(300);
    expect(mismatch.start).toBe(wc("2024-03-18T12:00"));
  });

  it("overnight sessions end the next day; days of week are respected", () => {
    const asia = occurrenceOn(S("asian"), "2024-01-15", "UTC")!; // Monday 19:00 NY = 00:00 UTC Tuesday
    expect([asia.start, asia.end]).toEqual([wc("2024-01-16T00:00"), wc("2024-01-16T09:00")]);
    expect(occurrenceOn(S("london"), "2024-01-13", "UTC")).toBeNull(); // Saturday
    expect(occurrenceOn(S("asian"), "2024-01-14", "UTC")).not.toBeNull(); // starts Sunday evening
  });

  it("a custom session in another zone, and the DST transition day itself", () => {
    const killzone: SessionDef = { id: "c1", name: "NY AM", start: "08:30", end: "11:00", timeZone: "America/New_York", days: [0, 1, 2, 3, 4, 5, 6], color: "#fff", enabled: true };
    const before = occurrenceOn(killzone, "2024-03-09", "UTC")!; // EST
    const after = occurrenceOn(killzone, "2024-03-10", "UTC")!; // EDT from 02:00
    expect(before.start).toBe(wc("2024-03-09T13:30"));
    expect(after.start).toBe(wc("2024-03-10T12:30"));
    expect(after.end - after.start).toBe(150);
  });

  it("next / previous / between, and the local date of a data minute", () => {
    const at = wc("2024-01-17T12:00"); // Wednesday, during London (UTC data)
    expect(nextOccurrence(S("london"), at, "UTC")!.date).toBe("2024-01-18");
    expect(previousOccurrence(S("london"), at, "UTC")!.date).toBe("2024-01-17");
    expect(nextOccurrence(S("london"), wc("2024-01-19T18:00"), "UTC")!.date).toBe("2024-01-22"); // over the weekend
    const week = occurrencesBetween(S("london"), wc("2024-01-15T00:00"), wc("2024-01-22T00:00"), "UTC");
    expect(week.map((o) => o.date)).toEqual(["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"]);
    expect(localDateOf(wc("2024-01-16T00:30"), S("asian"), "UTC")).toBe("2024-01-15"); // still Monday evening in New York
  });
});
