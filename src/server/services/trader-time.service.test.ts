import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import {
  TimezoneChangeError,
  getTraderTimezoneState,
  getTraderTodayKey,
  setTraderTimezone,
} from "@/server/services/trader-time.service";
import { presetToRange, presetToRangeForKey } from "@/lib/date-ranges";

/** Preparation Phase 0 — canonical trader timezone + today key (DB-backed). */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const at = (iso: string) => new Date(iso);

async function user(label: string) {
  const u = await createTestUser(label);
  userIds.push(u.id);
  return u;
}

describe("trader today key", () => {
  it("unconfigured → UTC calendar; configured → the trader's calendar from the next local date", async () => {
    const u = await user("tz-basic");
    const evening = at("2026-10-06T01:30:00Z"); // 21:30 in New York on Oct 5
    expect(await getTraderTodayKey(u.id, evening)).toBe("2026-10-06");

    const state = await setTraderTimezone(u.id, "America/New_York", evening);
    expect(state).toMatchObject({ timezone: "UTC", configured: false, todayKey: "2026-10-06" });
    expect(state.pending).toEqual({ timezone: "America/New_York", effectiveFrom: "2026-10-07T04:00:00.000Z" });

    // Today never moves when the change is confirmed…
    expect(await getTraderTodayKey(u.id, evening)).toBe("2026-10-06");
    // …and from the switch the New York calendar decides.
    expect(await getTraderTodayKey(u.id, at("2026-10-07T04:00:00Z"))).toBe("2026-10-07");
    expect(await getTraderTodayKey(u.id, at("2026-10-08T02:00:00Z"))).toBe("2026-10-07"); // 22:00 NY
    expect(await getTimezoneStateAfter(u.id, "2026-10-08T02:00:00Z")).toMatchObject({ timezone: "America/New_York", configured: true, pending: null });
  });

  it("re-confirming is a no-op; choosing the current zone cancels a pending change; invalid zones are refused", async () => {
    const u = await user("tz-cancel");
    await setTraderTimezone(u.id, "Europe/London", at("2026-01-01T12:00:00Z"));
    const now = at("2026-10-06T12:00:00Z");
    await setTraderTimezone(u.id, "Europe/London", now);
    expect(await prisma.traderTimezoneVersion.count({ where: { userId: u.id } })).toBe(1);

    const pending = await setTraderTimezone(u.id, "Asia/Tokyo", now);
    expect(pending.pending?.timezone).toBe("Asia/Tokyo");
    const cancelled = await setTraderTimezone(u.id, "Europe/London", at("2026-10-06T13:00:00Z"));
    expect(cancelled.pending).toBeNull();
    expect(await getTraderTodayKey(u.id, at("2026-10-07T12:00:00Z"))).toBe("2026-10-07");
    expect((await getTimezoneStateAfter(u.id, "2026-10-08T12:00:00Z")).timezone).toBe("Europe/London");

    await expect(setTraderTimezone(u.id, "Mars/Olympus", now)).rejects.toBeInstanceOf(TimezoneChangeError);
  });

  it("versions are append-only at the database level; deleting the user still cascades", async () => {
    const u = await user("tz-immutable");
    await setTraderTimezone(u.id, "Asia/Tokyo", at("2026-01-01T00:00:00Z"));
    const row = await prisma.traderTimezoneVersion.findFirstOrThrow({ where: { userId: u.id } });
    await expect(prisma.traderTimezoneVersion.update({ where: { id: row.id }, data: { timezone: "UTC" } })).rejects.toThrow(/TIMEZONE_IMMUTABLE/);
    await expect(prisma.traderTimezoneVersion.delete({ where: { id: row.id } })).rejects.toThrow(/TIMEZONE_IMMUTABLE/);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.traderTimezoneVersion.count({ where: { userId: u.id } })).toBe(0);
  });

  it("a timezone change never re-dates existing TradingDays", async () => {
    const u = await user("tz-history");
    await runLive(() => getOrCreateTradingDay(u.id, "2026-10-06"));
    await setTraderTimezone(u.id, "Pacific/Honolulu", at("2026-10-06T01:30:00Z"));
    await setTraderTimezone(u.id, "Asia/Tokyo", at("2026-10-09T01:30:00Z"));
    const days = await prisma.tradingDay.findMany({ where: { userId: u.id }, select: { date: true } });
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-10-06"]);
  });
});

describe("date-range presets on the trader calendar", () => {
  it("presetToRangeForKey is pure calendar arithmetic on the trader's today", () => {
    expect(presetToRangeForKey("week", "2026-10-05")).toEqual({ from: "2026-09-29", to: "2026-10-05" });
    expect(presetToRangeForKey("month", "2026-03-31")).toEqual({ from: "2026-03-03", to: "2026-03-31" }); // same overflow rule as before
    expect(presetToRangeForKey("ytd", "2026-10-05")).toEqual({ from: "2026-01-01", to: "2026-10-05" });
    expect(presetToRangeForKey("all", "2026-10-05").to).toBe("2026-10-05");
    // The Date-based helper is unchanged for client callers.
    expect(presetToRange("week", new Date(2026, 9, 5))).toEqual({ from: "2026-09-29", to: "2026-10-05" });
  });
});

async function getTimezoneStateAfter(userId: string, iso: string) {
  return getTraderTimezoneState(userId, at(iso));
}
