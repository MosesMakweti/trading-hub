import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  effectiveFromForChange,
  effectiveTimezoneAt,
  isValidTimeZone,
  localDateKeyAt,
  localDateTimeAt,
  localTimeToInstant,
  pendingTimezoneAt,
  startOfLocalDay,
  traderTodayKey,
  weekdayOfDateKey,
  type TimezoneVersion,
} from "@/domain/time/trader-calendar";

/** Preparation Phase 0 — the trader's calendar (pure). */

const at = (iso: string) => new Date(iso);
const v = (timezone: string, effectiveFrom: string, createdAt = effectiveFrom): TimezoneVersion => ({
  timezone,
  effectiveFrom: at(effectiveFrom),
  createdAt: at(createdAt),
});

describe("trader local date vs the UTC (server) calendar", () => {
  it("an evening in New York is still the previous date although UTC has rolled over", () => {
    const now = at("2026-10-06T01:30:00Z"); // 21:30 EDT on Oct 5
    expect(localDateKeyAt(now, "UTC")).toBe("2026-10-06");
    expect(localDateKeyAt(now, "America/New_York")).toBe("2026-10-05");
  });

  it("an early morning in Tokyo is already the next date while UTC is not", () => {
    const now = at("2026-10-05T16:00:00Z"); // 01:00 JST on Oct 6
    expect(localDateKeyAt(now, "UTC")).toBe("2026-10-05");
    expect(localDateKeyAt(now, "Asia/Tokyo")).toBe("2026-10-06");
  });

  it("no configured timezone keeps the UTC calendar (previous behaviour)", () => {
    expect(traderTodayKey([], at("2026-10-06T01:30:00Z"))).toBe("2026-10-06");
  });

  it("a configured timezone decides today", () => {
    expect(traderTodayKey([v("America/New_York", "2026-01-01T00:00:00Z")], at("2026-10-06T01:30:00Z"))).toBe("2026-10-05");
  });

  it("local wall clock, weekday and minutes", () => {
    const t = localDateTimeAt(at("2026-10-06T01:30:00Z"), "America/New_York");
    expect([t.dateKey, t.hour, t.minute, t.weekday, t.minutesOfDay]).toEqual(["2026-10-05", 21, 30, 1, 1290]);
    expect(weekdayOfDateKey("2026-10-05")).toBe(1);
    expect(weekdayOfDateKey("2026-10-10")).toBe(6);
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("DST", () => {
  it("spring forward: the same local target maps to a different UTC instant before/after", () => {
    expect(localTimeToInstant("2026-03-06", 480, "America/New_York").toISOString()).toBe("2026-03-06T13:00:00.000Z"); // EST
    expect(localTimeToInstant("2026-03-09", 480, "America/New_York").toISOString()).toBe("2026-03-09T12:00:00.000Z"); // EDT
    // 02:30 doesn't exist on 2026-03-08 — it resolves deterministically to a real instant on that date.
    const gap = localTimeToInstant("2026-03-08", 150, "America/New_York");
    expect(localDateKeyAt(gap, "America/New_York")).toBe("2026-03-08");
    expect(localTimeToInstant("2026-03-08", 150, "America/New_York").getTime()).toBe(gap.getTime());
  });

  it("fall back: an ambiguous local time resolves to one of its two instants, deterministically", () => {
    const amb = localTimeToInstant("2026-11-01", 90, "America/New_York");
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]).toContain(amb.toISOString());
    expect(localTimeToInstant("2026-11-01", 90, "America/New_York").getTime()).toBe(amb.getTime());
    expect(localTimeToInstant("2026-11-02", 480, "America/New_York").toISOString()).toBe("2026-11-02T13:00:00.000Z"); // EST again
  });

  it("start of the local day, including a zone whose DST change happens at midnight", () => {
    expect(startOfLocalDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfLocalDay("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfLocalDay("2026-03-29", "Europe/London").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(startOfLocalDay("2026-10-06", "Asia/Kolkata").toISOString()).toBe("2026-10-05T18:30:00.000Z");
    // Santiago skips 00:00–01:00 on 2026-09-06: the day starts at 01:00 local.
    expect(startOfLocalDay("2026-09-06", "America/Santiago").toISOString()).toBe("2026-09-06T04:00:00.000Z");
    for (let d = 1; d <= 30; d++) {
      const key = `2026-09-${String(d).padStart(2, "0")}`;
      const s = startOfLocalDay(key, "America/Santiago");
      expect(localDateKeyAt(s, "America/Santiago")).toBe(key);
      expect(localDateKeyAt(new Date(s.getTime() - 60_000), "America/Santiago") < key).toBe(true);
    }
  });
});

describe("versioned timezone — changes govern from the next local date, never backwards", () => {
  it("effective / pending selection with tie-break on createdAt", () => {
    const versions = [
      v("Europe/London", "2026-01-01T00:00:00Z"),
      v("Asia/Tokyo", "2026-10-07T00:00:00Z", "2026-10-06T10:00:00Z"),
      v("America/New_York", "2026-10-07T00:00:00Z", "2026-10-06T11:00:00Z"),
    ];
    expect(effectiveTimezoneAt(versions, at("2026-10-06T12:00:00Z"))).toBe("Europe/London");
    expect(pendingTimezoneAt(versions, at("2026-10-06T12:00:00Z"))?.timezone).toBe("America/New_York");
    expect(effectiveTimezoneAt(versions, at("2026-10-07T00:00:00Z"))).toBe("America/New_York");
    expect(pendingTimezoneAt(versions, at("2026-10-07T00:00:00Z"))).toBeNull();
  });

  it("first configuration (UTC → New York, westward): switches when New York starts the next date", () => {
    const now = at("2026-10-06T01:30:00Z"); // UTC date 10-06, NY evening 10-05
    const from = effectiveFromForChange([], "America/New_York", now);
    expect(from.toISOString()).toBe("2026-10-07T04:00:00.000Z");
    const after = [v("America/New_York", from.toISOString(), now.toISOString())];
    expect(traderTodayKey(after, new Date(from.getTime() - 1))).toBe("2026-10-07"); // still UTC calendar
    expect(traderTodayKey(after, from)).toBe("2026-10-07"); // NY calendar, same date
  });

  it("eastward change switches at the current zone's midnight", () => {
    const now = at("2026-10-06T12:00:00Z");
    const versions = [v("Europe/London", "2026-01-01T00:00:00Z")];
    const from = effectiveFromForChange(versions, "Asia/Tokyo", now);
    expect(from.toISOString()).toBe("2026-10-06T23:00:00.000Z"); // London midnight (BST) of 10-07
  });

  it("the today key never moves backwards across any change (exhaustive sweep)", () => {
    const zones = ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "Pacific/Honolulu", "Pacific/Auckland"];
    const nows = ["2026-03-08T06:30:00Z", "2026-10-06T01:30:00Z", "2026-10-06T22:15:00Z", "2026-11-01T05:59:00Z"].map(at);
    for (const fromZone of zones) {
      for (const toZone of zones) {
        for (const now of nows) {
          const base = [v(fromZone, "2025-01-01T00:00:00Z")];
          const eff = effectiveFromForChange(base, toZone, now);
          expect(eff.getTime()).toBeGreaterThan(now.getTime());
          const versions = [...base, { timezone: toZone, effectiveFrom: eff, createdAt: now }];
          const todayAtRequest = traderTodayKey(versions, now);
          let prev = todayAtRequest;
          for (let t = now.getTime(); t < now.getTime() + 3 * 86_400_000; t += 15 * 60_000) {
            const key = traderTodayKey(versions, new Date(t));
            expect(key >= prev).toBe(true);
            prev = key;
          }
          // The date of the request itself is never re-labelled.
          expect(traderTodayKey(versions, new Date(now.getTime()))).toBe(localDateKeyAt(now, fromZone));
        }
      }
    }
  });

  it("a ≥24h westward jump across the date line is refused (change in two steps)", () => {
    expect(() => effectiveFromForChange([v("Pacific/Kiritimati", "2025-01-01T00:00:00Z")], "Pacific/Pago_Pago", at("2026-10-06T12:00:00Z"))).toThrow(
      /two steps/,
    );
  });
});
