import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/guards", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireUser } from "@/server/guards";
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { confirmPreparationSchedule, finalizePreparationDays, getPreparationState, getScheduleVersions } from "@/server/services/preparation.service";
import { getTraderTimezoneState } from "@/server/services/trader-time.service";
import { addDaysToDateKey, localDateKeyAt, localTimeToInstant } from "@/domain/time/trader-calendar";
import {
  acknowledgePreparationNoticeAction,
  addPreparationExceptionAction,
  savePreparationScheduleAction,
} from "@/actions/preparation.actions";

/**
 * Preparation Phase 3 — server actions. They run on the real clock, so
 * dates are derived from "now" in the trader's zone.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const NY = "America/New_York";

async function user(label: string, timezone: string | null = NY) {
  const u = await createTestUser(label);
  userIds.push(u.id);
  if (timezone) await prisma.traderTimezoneVersion.create({ data: { userId: u.id, timezone, effectiveFrom: new Date("2020-01-01T00:00:00Z") } });
  return u.id;
}
const signIn = (id: string) => vi.mocked(requireUser).mockResolvedValue({ id } as Awaited<ReturnType<typeof requireUser>>);
const todayNY = () => localDateKeyAt(new Date(), NY);
/** The next date (after `from`) whose weekday is in `days`. */
function nextWeekday(from: string, days: number[]): string {
  let d = addDaysToDateKey(from, 1);
  while (!days.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysToDateKey(d, 1);
  return d;
}

beforeEach(() => vi.mocked(requireUser).mockReset());

describe("authentication", () => {
  it("every action requires a signed-in user and never takes a userId from input", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(savePreparationScheduleAction({ timezone: NY, targetMinutes: 480, weekdays: [1] })).rejects.toThrow("NEXT_REDIRECT");
    await expect(addPreparationExceptionAction({ dateKey: "2026-12-01", kind: "DAY_OFF" })).rejects.toThrow("NEXT_REDIRECT");
    await expect(acknowledgePreparationNoticeAction({ recordId: "x" })).rejects.toThrow("NEXT_REDIRECT");

    // A smuggled userId is ignored: the schedule lands on the signed-in user.
    const me = await user("p3a-me");
    const other = await user("p3a-other");
    signIn(me);
    const r = await savePreparationScheduleAction({ userId: other, timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] });
    expect(r.success).toBe(true);
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: me } })).toBe(1);
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: other } })).toBe(0);
  });
});

describe("savePreparationScheduleAction", () => {
  it("creates the schedule from the next local date, updates target and weekdays, and validates input", async () => {
    const id = await user("p3a-schedule");
    signIn(id);
    const first = await savePreparationScheduleAction({ timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] });
    expect(first).toMatchObject({ success: true, settings: { upcoming: { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5], timezone: NY } } });
    const tomorrow = addDaysToDateKey(todayNY(), 1);
    expect(first.success && first.settings.upcoming?.effectiveFrom).toBe(tomorrow);

    // Weekday + target update → still a new version for tomorrow (latest wins); today never changes.
    const second = await savePreparationScheduleAction({ timezone: NY, targetMinutes: 465, weekdays: [1, 3, 5] });
    expect(second).toMatchObject({ success: true, settings: { upcoming: { targetMinutes: 465, weekdays: [1, 3, 5] }, current: null } });
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: id } })).toBe(2);

    // Double submit: no duplicate.
    await savePreparationScheduleAction({ timezone: NY, targetMinutes: 465, weekdays: [5, 3, 1] });
    expect(await prisma.preparationScheduleVersion.count({ where: { userId: id } })).toBe(2);

    expect(await savePreparationScheduleAction({ timezone: NY, targetMinutes: 480, weekdays: [] })).toMatchObject({ success: false, error: "Choose at least one trading weekday." });
    expect(await savePreparationScheduleAction({ timezone: NY, targetMinutes: 1440, weekdays: [1] })).toMatchObject({ success: false });
    expect(await savePreparationScheduleAction({ timezone: "Mars/Base", targetMinutes: 480, weekdays: [1] })).toMatchObject({ success: false, error: "Choose a valid timezone." });
  });

  it("a different timezone in the form changes the canonical trader timezone, and the schedule follows it", async () => {
    const id = await user("p3a-tz", null); // unconfigured (UTC)
    signIn(id);
    const r = await savePreparationScheduleAction({ timezone: "Europe/London", targetMinutes: 420, weekdays: [1, 2, 3, 4, 5] });
    expect(r).toMatchObject({ success: true, settings: { trader: { pendingTimezone: "Europe/London" }, upcoming: { timezone: "Europe/London", targetMinutes: 420 } } });
    expect((await getTraderTimezoneState(id)).pending?.timezone).toBe("Europe/London");
    const versions = await getScheduleVersions(id);
    expect(new Set(versions.map((v) => v.timezone))).toEqual(new Set(["Europe/London"]));
  });
});

describe("exception actions", () => {
  it("DAY_OFF and EXTRA_DAY for upcoming dates; refusals come back as clean errors", async () => {
    const id = await user("p3a-exc");
    // A schedule already in effect (confirmed long ago), so tomorrow onward is governed.
    await confirmPreparationSchedule(id, { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] }, new Date("2026-01-01T15:00:00Z"));
    signIn(id);
    const weekday = nextWeekday(todayNY(), [1, 2, 3, 4, 5]);
    const weekend = nextWeekday(todayNY(), [0, 6]);
    const off = await addPreparationExceptionAction({ dateKey: weekday, kind: "DAY_OFF", note: "  Dentist  " });
    expect(off).toMatchObject({ success: true });
    expect(off.success && off.settings.upcomingExceptions).toContainEqual(expect.objectContaining({ dateKey: weekday, kind: "DAY_OFF", note: "Dentist" }));
    const extra = await addPreparationExceptionAction({ dateKey: weekend, kind: "EXTRA_DAY" });
    expect(extra.success && extra.settings.upcomingExceptions.map((e) => e.kind)).toContain("EXTRA_DAY");

    // Late DAY_OFF: a past scheduled date (its target has passed) is refused by the server.
    const past = "2026-03-02"; // a Monday in the scoring era, long past
    expect(await addPreparationExceptionAction({ dateKey: past, kind: "DAY_OFF" })).toEqual({ success: false, error: "A day off must be set before that day's target time." });
    expect(await addPreparationExceptionAction({ dateKey: weekend, kind: "DAY_OFF" })).toEqual({ success: false, error: "That date isn't a scheduled trading day." });
    expect(await addPreparationExceptionAction({ dateKey: weekday, kind: "EXTRA_DAY" })).toEqual({ success: false, error: "That date is already a scheduled trading day." });
    expect(await addPreparationExceptionAction({ dateKey: "2026-02-30", kind: "DAY_OFF" })).toMatchObject({ success: false, error: "Choose a valid date." });
    expect(await addPreparationExceptionAction({ dateKey: weekday, kind: "HOLIDAY" })).toMatchObject({ success: false });
  });
});

describe("acknowledgePreparationNoticeAction", () => {
  it("dismisses the signed-in trader's notice; another trader's record id is a no-op", async () => {
    const owner = await user("p3a-notice");
    const intruder = await user("p3a-intruder");
    // Oct 5 prepared on time (streak 1), Oct 6 missed → notice.
    await confirmPreparationSchedule(owner, { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] }, new Date("2026-10-04T15:00:00Z"));
    await prisma.tradingDay.create({
      data: { userId: owner, date: new Date("2026-10-05T00:00:00Z"), routineFirstReadyAt: localTimeToInstant("2026-10-05", 475, NY), routineScoringRequirements: [] },
    });
    const evening = localTimeToInstant("2026-10-06", 20 * 60, NY);
    await runLive(() => finalizePreparationDays(owner, evening));
    const notice = (await runLive(() => getPreparationState(owner, evening))).notice;
    expect(notice).toMatchObject({ dateKey: "2026-10-06", status: "MISSED", endedLength: 1 });

    signIn(intruder);
    expect(await acknowledgePreparationNoticeAction({ recordId: notice!.recordId })).toEqual({ success: true });
    expect((await runLive(() => getPreparationState(owner, evening))).notice).not.toBeNull();

    signIn(owner);
    expect(await acknowledgePreparationNoticeAction({ recordId: notice!.recordId })).toEqual({ success: true });
    expect((await runLive(() => getPreparationState(owner, evening))).notice).toBeNull();
    expect(await acknowledgePreparationNoticeAction({ recordId: "" })).toEqual({ success: false, error: "Invalid notice." });
  });
});
