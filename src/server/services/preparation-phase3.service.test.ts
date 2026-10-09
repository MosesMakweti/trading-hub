import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import {
  PreparationError,
  addPreparationException,
  confirmPreparationSchedule,
  getPreparationScheduleOverview,
  getPreparationState,
  getScheduleVersions,
} from "@/server/services/preparation.service";
import { getTraderTodayKey, setTraderTimezone } from "@/server/services/trader-time.service";
import { localTimeToInstant } from "@/domain/time/trader-calendar";

/**
 * Preparation Phase 3 — timezone synchronization, the trader-calendar
 * "today", the Settings overview and exceptions. New York trader, schedule
 * confirmed Sun 2026-10-04 → effective Mon 2026-10-05, 08:00 Mon–Fri.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
const ny = (dateKey: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localTimeToInstant(dateKey, h * 60 + m, NY);
};

async function trader(label: string, opts: { schedule?: boolean; timezone?: string | null } = {}) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  if (opts.timezone !== null) {
    await prisma.traderTimezoneVersion.create({ data: { userId: user.id, timezone: opts.timezone ?? NY, effectiveFrom: at("2020-01-01T00:00:00Z") } });
  }
  if (opts.schedule !== false) {
    await confirmPreparationSchedule(user.id, { targetMinutes: 8 * 60, weekdays: [1, 2, 3, 4, 5] }, at("2026-10-04T15:00:00Z"));
  }
  return user.id;
}

const versionsOf = async (userId: string) =>
  (await getScheduleVersions(userId)).map((v) => [v.effectiveFrom, v.timezone, v.targetMinutes, v.weekdays.join("")]);

describe("timezone synchronization", () => {
  it("a trader timezone change appends a schedule version in the new zone from the same next local date", async () => {
    const id = await trader("p3-sync");
    const before = await prisma.preparationScheduleVersion.findMany({ where: { userId: id } });
    await setTraderTimezone(id, "Europe/London", ny("2026-10-07", "10:00"));
    expect(await versionsOf(id)).toEqual([
      ["2026-10-05", NY, 480, "12345"],
      ["2026-10-08", "Europe/London", 480, "12345"],
    ]);
    // Existing versions are untouched (they are immutable anyway).
    expect(await prisma.preparationScheduleVersion.findMany({ where: { id: { in: before.map((b) => b.id) } } })).toEqual(before);
    // The trader timezone switches at the start of the same date.
    expect(await getTraderTodayKey(id, at("2026-10-08T04:00:00Z"))).toBe("2026-10-08");
  });

  it("no schedule → nothing to sync; re-confirming the same zone → no new version", async () => {
    const none = await trader("p3-sync-none", { schedule: false });
    await setTraderTimezone(none, "Asia/Tokyo", ny("2026-10-07", "10:00"));
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: none } })).toBe(0);

    const same = await trader("p3-sync-same");
    await setTraderTimezone(same, NY, ny("2026-10-07", "10:00"));
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: same } })).toBe(1);
  });

  it("cancelling a pending timezone change re-syncs the schedule; the overview shows no upcoming change", async () => {
    const id = await trader("p3-sync-cancel");
    await setTraderTimezone(id, "Asia/Tokyo", ny("2026-10-07", "10:00"));
    await setTraderTimezone(id, NY, ny("2026-10-07", "11:00"));
    const versions = await getScheduleVersions(id);
    const forTomorrow = versions.filter((v) => v.effectiveFrom === "2026-10-08");
    expect(forTomorrow.map((v) => v.timezone)).toEqual(["Asia/Tokyo", NY]);
    const overview = await getPreparationScheduleOverview(id, ny("2026-10-07", "12:00"));
    expect(overview.current).toMatchObject({ timezone: NY, targetMinutes: 480 });
    expect(overview.upcoming).toBeNull();
  });

  it("a schedule confirmed while a timezone change is pending uses the pending zone (no drift)", async () => {
    const id = await trader("p3-confirm-pending");
    await setTraderTimezone(id, "Europe/London", ny("2026-10-07", "10:00"));
    await confirmPreparationSchedule(id, { targetMinutes: 7 * 60, weekdays: [1, 2, 3, 4] }, ny("2026-10-07", "10:05"));
    const overview = await getPreparationScheduleOverview(id, ny("2026-10-07", "10:10"));
    expect(overview.upcoming).toEqual({ timezone: "Europe/London", targetMinutes: 420, weekdays: [1, 2, 3, 4], effectiveFrom: "2026-10-08" });
  });

  it("a schedule edit followed by a timezone change keeps the edit (the later write wins even with an earlier clock)", async () => {
    const id = await trader("p3-edit-then-tz");
    await confirmPreparationSchedule(id, { targetMinutes: 9 * 60, weekdays: [1, 3, 5] }, ny("2026-10-07", "10:05"));
    // The timezone call carries an EARLIER `now` than the schedule edit.
    await setTraderTimezone(id, "Europe/London", ny("2026-10-07", "10:00"));
    const overview = await getPreparationScheduleOverview(id, ny("2026-10-07", "10:10"));
    expect(overview.upcoming).toEqual({ timezone: "Europe/London", targetMinutes: 540, weekdays: [1, 3, 5], effectiveFrom: "2026-10-08" });
  });

  it("an unconfigured (UTC) trader's schedule follows the first confirmed timezone", async () => {
    const id = await trader("p3-utc", { timezone: null });
    expect((await getScheduleVersions(id))[0].timezone).toBe("UTC");
    await setTraderTimezone(id, "Asia/Tokyo", at("2026-10-07T10:00:00Z"));
    expect((await versionsOf(id)).at(-1)).toEqual(["2026-10-08", "Asia/Tokyo", 480, "12345"]);
  });
});

describe("Preparation today = the trader's canonical today", () => {
  it("while an eastward change is pending, Preparation stays on the trader's current date", async () => {
    const id = await trader("p3-today-key");
    await setTraderTimezone(id, "Asia/Tokyo", ny("2026-10-05", "12:00"));
    // 20:00 New York on Mon Oct 5 is already Tue Oct 6 in Tokyo.
    const evening = ny("2026-10-05", "20:00");
    expect(await getTraderTodayKey(id, evening)).toBe("2026-10-05");
    const s = await runLive(() => getPreparationState(id, evening));
    expect(s.todayKey).toBe("2026-10-05");
    expect(s.schedule?.timezone).toBe(NY);
    expect(s.pendingSchedule).toMatchObject({ timezone: "Asia/Tokyo", effectiveFrom: "2026-10-06" });
    expect(s.scoring).toEqual({ completionMax: 70, timingMax: 30 });
  });
});

describe("Settings overview and exceptions", () => {
  it("lists current, upcoming, the next effective date and only upcoming exceptions", async () => {
    const id = await trader("p3-overview");
    await addPreparationException(id, "2026-10-12", "DAY_OFF", ny("2026-10-07", "09:00"), "Holiday");
    await addPreparationException(id, "2026-10-10", "EXTRA_DAY", ny("2026-10-07", "09:00"));
    await addPreparationException(id, "2026-10-06", "DAY_OFF", ny("2026-10-05", "09:00")); // past by Oct 7
    await confirmPreparationSchedule(id, { targetMinutes: 510, weekdays: [1, 2, 3, 4, 5] }, ny("2026-10-07", "10:00"));
    const o = await getPreparationScheduleOverview(id, ny("2026-10-07", "10:30"));
    expect(o).toMatchObject({
      todayKey: "2026-10-07",
      nextEffectiveFrom: "2026-10-08",
      current: { timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], effectiveFrom: "2026-10-05" },
      upcoming: { timezone: NY, targetMinutes: 510, effectiveFrom: "2026-10-08" },
    });
    expect(o.upcomingExceptions.map((e) => [e.dateKey, e.kind, e.note])).toEqual([
      ["2026-10-10", "EXTRA_DAY", null],
      ["2026-10-12", "DAY_OFF", "Holiday"],
    ]);
  });

  it("DAY_OFF only on a scheduled date before its target; EXTRA_DAY only on an unscheduled date before its target", async () => {
    const id = await trader("p3-exceptions");
    await expect(addPreparationException(id, "2026-10-08", "DAY_OFF", ny("2026-10-08", "08:00"))).rejects.toThrow(/before that day's target/);
    await expect(addPreparationException(id, "2026-10-11", "DAY_OFF", ny("2026-10-08", "08:00"))).rejects.toThrow(/isn't a scheduled trading day/);
    await expect(addPreparationException(id, "2026-10-09", "EXTRA_DAY", ny("2026-10-08", "08:00"))).rejects.toThrow(/already a scheduled/);
    await expect(addPreparationException(id, "2026-10-01", "DAY_OFF", ny("2026-09-30", "08:00"))).rejects.toBeInstanceOf(PreparationError);
    await addPreparationException(id, "2026-10-08", "DAY_OFF", ny("2026-10-08", "07:59"));
    await addPreparationException(id, "2026-10-10", "EXTRA_DAY", ny("2026-10-08", "07:59"));
    const s = await runLive(() => getPreparationState(id, ny("2026-10-08", "09:00")));
    expect(s.today.kind).toBe("DAY_OFF");
    const sat = await runLive(() => getPreparationState(id, ny("2026-10-10", "07:00")));
    expect(sat.today.kind).toBe("PENDING");
  });
});
