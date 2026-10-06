import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { endDay, getOrCreateTradingDay, getTradingDay, reopenDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady, setRoutineResponse } from "@/server/services/today-routine.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import {
  PreparationError,
  acknowledgePreparationNotice,
  addPreparationCorrection,
  addPreparationException,
  confirmPreparationSchedule,
  finalizePreparationDays,
  getPreparationState,
  getScheduleVersions,
  loadPreparationState,
} from "@/server/services/preparation.service";
import { setTraderTimezone } from "@/server/services/trader-time.service";
import { localTimeToInstant } from "@/domain/time/trader-calendar";
import type { RoutineSnapshot } from "@/domain/today/routine-snapshot";

/**
 * Preparation Score Phase 2 — persistence, finalization, read model.
 * New York trader, schedule confirmed Sun 2026-10-04 → effective Mon 2026-10-05,
 * 08:00 target (12:00Z in October), cutoff 14:00 local (18:00Z).
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
/** Local New York wall time on a date → instant. */
const ny = (dateKey: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localTimeToInstant(dateKey, h * 60 + m, NY);
};
const minutes = (d: Date, delta: number) => new Date(d.getTime() + delta * 60_000);

interface Trader {
  id: string;
  items: { a: string; b: string; text: string; optional: string };
}

/** A trader on New York time with a 3-mandatory (2 checkbox + 1 text) + 1 optional routine. */
async function trader(label: string, opts: { schedule?: boolean } = {}): Promise<Trader> {
  const user = await createTestUser(label);
  userIds.push(user.id);
  await prisma.traderTimezoneVersion.create({ data: { userId: user.id, timezone: NY, effectiveFrom: at("2020-01-01T00:00:00Z") } });
  const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
  const mk = (label: string, type: "CHECKBOX" | "SHORT_TEXT", isMandatory: boolean, sortOrder: number) =>
    prisma.routineItem.create({ data: { userId: user.id, sectionId: section.id, label, type, isMandatory, sortOrder } });
  const [a, b, text, optional] = await Promise.all([
    mk("Check calendar", "CHECKBOX", true, 0),
    mk("Mark levels", "CHECKBOX", true, 1),
    mk("Bias note", "SHORT_TEXT", true, 2),
    mk("Stretch", "CHECKBOX", false, 3),
  ]);
  if (opts.schedule !== false) {
    await confirmPreparationSchedule(user.id, { targetMinutes: 8 * 60, weekdays: [1, 2, 3, 4, 5] }, at("2026-10-04T15:00:00Z"));
  }
  return { id: user.id, items: { a: a.id, b: b.id, text: text.id, optional: optional.id } };
}

/** Opens the day's routine (freezing scoring requirements). */
async function openDay(t: Trader, dateKey: string) {
  return runLive(async () => {
    const day = await getOrCreateTradingDay(t.id, dateKey);
    return getOrCreateDayRoutine(t.id, day);
  });
}

/** Completes every mandatory item at `when` and confirms readiness at `readyAt`. */
async function prepare(t: Trader, dateKey: string, when: Date, readyAt: Date = when) {
  await openDay(t, dateKey);
  await runLive(async () => {
    await setRoutineResponse(t.id, dateKey, t.items.a, { checked: true }, when);
    await setRoutineResponse(t.id, dateKey, t.items.b, { checked: true }, when);
    await setRoutineResponse(t.id, dateKey, t.items.text, { text: "Bullish above 2010" }, when);
    await setRoutineReady(t.id, dateKey, true, readyAt);
  });
}

const record = (userId: string, dateKey: string) =>
  prisma.preparationDayRecord.findFirst({ where: { userId, date: new Date(`${dateKey}T00:00:00Z`) } });
const finalize = (userId: string, now: Date) => runLive(() => finalizePreparationDays(userId, now));
const state = (userId: string, now: Date) => runLive(() => getPreparationState(userId, now));
const snapshotOf = async (userId: string, dateKey: string) =>
  (await runLive(() => getTradingDay(userId, dateKey)))!.routineSnapshot as unknown as RoutineSnapshot;

// ── Schedule ────────────────────────────────────────────────────────────────

describe("Preparation Schedule versions", () => {
  it("confirming creates a version effective the trader's next local date; double submit creates one; changes append", async () => {
    const t = await trader("prep-sched", { schedule: false });
    const now = at("2026-10-06T01:30:00Z"); // 21:30 NY on Mon Oct 5
    const [r1, r2] = await Promise.all([
      confirmPreparationSchedule(t.id, { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] }, now),
      confirmPreparationSchedule(t.id, { targetMinutes: 480, weekdays: [5, 4, 3, 2, 1] }, now),
    ]);
    expect([r1.created, r2.created].sort()).toEqual([false, true]);
    const versions = await getScheduleVersions(t.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ effectiveFrom: "2026-10-06", timezone: NY, targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] });
    expect(versions[0].rules.scoringVersion).toBe(1);

    await confirmPreparationSchedule(t.id, { targetMinutes: 540, weekdays: [1, 2, 3, 4, 5] }, at("2026-10-07T15:00:00Z"));
    expect((await getScheduleVersions(t.id)).map((v) => [v.effectiveFrom, v.targetMinutes])).toEqual([
      ["2026-10-06", 480],
      ["2026-10-08", 540],
    ]);
    const row = await prisma.preparationScheduleVersion.findFirstOrThrow({ where: { userId: t.id } });
    await expect(prisma.preparationScheduleVersion.update({ where: { id: row.id }, data: { targetMinutes: 600 } })).rejects.toThrow(/PREPARATION_IMMUTABLE/);
    await expect(prisma.preparationScheduleVersion.delete({ where: { id: row.id } })).rejects.toThrow(/PREPARATION_IMMUTABLE/);
    await expect(confirmPreparationSchedule(t.id, { targetMinutes: 2000, weekdays: [] }, now)).rejects.toBeInstanceOf(PreparationError);
  });

  it("no schedule → no records, no misses, no streak", async () => {
    const t = await trader("prep-none", { schedule: false });
    await openDay(t, "2026-10-05");
    expect(await finalize(t.id, at("2026-10-20T00:00:00Z"))).toBe(0);
    expect(await prisma.preparationDayRecord.count({ where: { userId: t.id } })).toBe(0);
    expect(await state(t.id, at("2026-10-20T00:00:00Z"))).toMatchObject({ configured: false, notice: null, streak: { current: 0, longest: 0 } });
  });

  it("6. a schedule edit never rewrites today's schedule (it governs from tomorrow)", async () => {
    const t = await trader("prep-sched-edit");
    await confirmPreparationSchedule(t.id, { targetMinutes: 10 * 60, weekdays: [1, 2, 3, 4, 5] }, ny("2026-10-05", "07:00"));
    await prepare(t, "2026-10-05", ny("2026-10-05", "08:05"));
    const r = await record(t.id, "2026-10-05");
    expect([r?.targetAt.toISOString(), r?.status]).toEqual([ny("2026-10-05", "08:00").toISOString(), "ON_TIME"]);
    await prepare(t, "2026-10-06", ny("2026-10-06", "08:05"));
    expect((await record(t.id, "2026-10-06"))?.status).toBe("EARLY"); // the 10:00 target applies from Oct 6
  });
});

// ── Routine facts ───────────────────────────────────────────────────────────

describe("write-once routine facts", () => {
  it("1/2. routineFirstReadyAt: first confirmation only; reopen and re-confirm never change it; DB backstop", async () => {
    const t = await trader("prep-first-ready");
    const d = "2026-10-05";
    await prepare(t, d, ny(d, "07:40"), ny(d, "07:50"));
    await runLive(() => setRoutineReady(t.id, d, false, ny(d, "08:30"))); // reopen
    let day = (await runLive(() => getTradingDay(t.id, d)))!;
    expect([day.routineReadyAt, day.routineFirstReadyAt?.toISOString()]).toEqual([null, ny(d, "07:50").toISOString()]);
    await runLive(() => setRoutineReady(t.id, d, true, ny(d, "09:00"))); // re-confirm
    day = (await runLive(() => getTradingDay(t.id, d)))!;
    expect([day.routineReadyAt?.toISOString(), day.routineFirstReadyAt?.toISOString()]).toEqual([
      ny(d, "09:00").toISOString(),
      ny(d, "07:50").toISOString(),
    ]);
    await expect(prisma.tradingDay.update({ where: { id: day.id }, data: { routineFirstReadyAt: ny(d, "06:00") } })).rejects.toThrow(/write-once/);
    expect((await record(t.id, d))?.status).toBe("ON_TIME");
  });

  it("concurrent first confirmations produce exactly one first-ready instant", async () => {
    const t = await trader("prep-first-ready-race");
    const d = "2026-10-05";
    await prepare(t, d, ny(d, "07:00"), ny(d, "07:01"));
    const t2 = await trader("prep-first-ready-race2");
    await openDay(t2, d);
    await runLive(async () => {
      for (const id of [t2.items.a, t2.items.b]) await setRoutineResponse(t2.id, d, id, { checked: true }, ny(d, "07:00"));
      await setRoutineResponse(t2.id, d, t2.items.text, { text: "x" }, ny(d, "07:00"));
    });
    await runLive(() => Promise.all([setRoutineReady(t2.id, d, true, ny(d, "07:10")), setRoutineReady(t2.id, d, true, ny(d, "07:20"))]));
    const day = (await runLive(() => getTradingDay(t2.id, d)))!;
    expect([ny(d, "07:10").toISOString(), ny(d, "07:20").toISOString()]).toContain(day.routineFirstReadyAt?.toISOString());
    expect(await prisma.preparationDayRecord.count({ where: { userId: t2.id } })).toBe(1);
  });

  it("3/4. firstCompletedAt: server time, immutable through uncheck/recheck and text delete/re-entry; concurrent saves lose nothing", async () => {
    const t = await trader("prep-first-completed");
    const d = "2026-10-05";
    await openDay(t, d);
    await runLive(async () => {
      await setRoutineResponse(t.id, d, t.items.a, { checked: true }, ny(d, "07:00"));
      await setRoutineResponse(t.id, d, t.items.a, { checked: false }, ny(d, "07:05"));
      await setRoutineResponse(t.id, d, t.items.a, { checked: true }, ny(d, "07:10"));
      await setRoutineResponse(t.id, d, t.items.text, { text: "  " }, ny(d, "07:01")); // blank: not complete
      await setRoutineResponse(t.id, d, t.items.text, { text: "Plan" }, ny(d, "07:02"));
      await setRoutineResponse(t.id, d, t.items.text, { text: "" }, ny(d, "07:03"));
      await setRoutineResponse(t.id, d, t.items.text, { text: "Plan again" }, ny(d, "07:04"));
      // A client can never supply the timestamp.
      await setRoutineResponse(t.id, d, t.items.b, { checked: false, firstCompletedAt: "2020-01-01T00:00:00.000Z" } as never, ny(d, "07:06"));
    });
    let snap = await snapshotOf(t.id, d);
    expect(snap.responses[t.items.a]).toMatchObject({ checked: true, firstCompletedAt: ny(d, "07:00").toISOString() });
    expect(snap.responses[t.items.text]).toMatchObject({ text: "Plan again", firstCompletedAt: ny(d, "07:02").toISOString() });
    expect(snap.responses[t.items.b].firstCompletedAt).toBeUndefined();

    await runLive(() =>
      Promise.all([
        setRoutineResponse(t.id, d, t.items.b, { checked: true }, ny(d, "07:20")),
        setRoutineResponse(t.id, d, t.items.optional, { checked: true }, ny(d, "07:21")),
        setRoutineResponse(t.id, d, t.items.a, { checked: false }, ny(d, "07:22")),
      ]),
    );
    snap = await snapshotOf(t.id, d);
    expect([snap.responses[t.items.b].firstCompletedAt, snap.responses[t.items.optional].firstCompletedAt, snap.responses[t.items.a].firstCompletedAt]).toEqual([
      ny(d, "07:20").toISOString(),
      ny(d, "07:21").toISOString(),
      ny(d, "07:00").toISOString(),
    ]);
    const day = (await runLive(() => getTradingDay(t.id, d)))!;
    const tampered = structuredClone(snap) as RoutineSnapshot;
    tampered.responses[t.items.a].firstCompletedAt = ny(d, "06:00").toISOString();
    await expect(prisma.tradingDay.update({ where: { id: day.id }, data: { routineSnapshot: tampered as never } })).rejects.toThrow(/write-once/);
  });

  it("5. frozen scoring requirements: template edits change the gate, never the scoring denominator", async () => {
    const t = await trader("prep-frozen-req");
    const d = "2026-10-05";
    await openDay(t, d);
    let day = (await runLive(() => getTradingDay(t.id, d)))!;
    expect(day.routineScoringRequirements).toEqual([t.items.a, t.items.b, t.items.text]);
    // Make the optional item mandatory and delete one mandatory item in the template.
    await prisma.routineItem.update({ where: { id: t.items.optional }, data: { isMandatory: true } });
    await prisma.routineItem.update({ where: { id: t.items.b }, data: { deletedAt: new Date() } });
    await openDay(t, d);
    day = (await runLive(() => getTradingDay(t.id, d)))!;
    expect(day.routineScoringRequirements).toEqual([t.items.a, t.items.b, t.items.text]);
    await expect(prisma.tradingDay.update({ where: { id: day.id }, data: { routineScoringRequirements: [t.items.a] } })).rejects.toThrow(/write-once/);
    // The gate follows the live template (unchanged behaviour): the newly mandatory item is now required to be ready.
    await runLive(async () => {
      await setRoutineResponse(t.id, d, t.items.a, { checked: true }, ny(d, "07:00"));
      await setRoutineResponse(t.id, d, t.items.text, { text: "x" }, ny(d, "07:00"));
    });
    await expect(runLive(() => setRoutineReady(t.id, d, true, ny(d, "07:30")))).rejects.toThrow(/required/);
    await runLive(() => setRoutineResponse(t.id, d, t.items.optional, { checked: true }, ny(d, "07:31")));
    await runLive(() => setRoutineReady(t.id, d, true, ny(d, "07:32")));
    // Scoring used the frozen set: the removed item b was never completed, yet readiness by the cutoff is 70/70.
    expect(await record(t.id, d)).toMatchObject({ status: "ON_TIME", requiredTotal: 3, completionPoints: 70, score: 100 });
  });
});

// ── Finalization ────────────────────────────────────────────────────────────

describe("finalization", () => {
  it("completed days are finalized immediately with the frozen version; every timing status", async () => {
    const t = await trader("prep-statuses");
    const cases: [string, string, string, number][] = [
      ["2026-10-05", "04:40", "VERY_EARLY", 85],
      ["2026-10-06", "06:30", "EARLY", 95],
      ["2026-10-07", "07:55", "ON_TIME", 100],
      ["2026-10-08", "08:20", "LATE", 95],
      ["2026-10-09", "10:30", "VERY_LATE", 75],
    ];
    for (const [d, hhmm, status, score] of cases) {
      await prepare(t, d, ny(d, hhmm));
      const r = await record(t.id, d);
      expect([r?.status, r?.score, r?.completionPoints, r?.timezone, r?.scoringVersion]).toEqual([status, score, 70, NY, 1]);
      expect(r?.finalizedAt.toISOString()).toBe(ny(d, hhmm).toISOString()); // persisted at readiness, not later
    }
    const s = await state(t.id, ny("2026-10-12", "07:00")); // Monday, before target
    expect(s.streak).toMatchObject({ current: 5, longest: 5, lastBreak: null });
    expect(s.today).toMatchObject({ kind: "PENDING" });
  });

  it("partial → INCOMPLETE using only items completed by the cutoff; later items and late readiness never help", async () => {
    const t = await trader("prep-incomplete");
    const d = "2026-10-05";
    await openDay(t, d);
    await runLive(async () => {
      await setRoutineResponse(t.id, d, t.items.a, { checked: true }, ny(d, "07:00"));
      await setRoutineResponse(t.id, d, t.items.b, { checked: true }, ny(d, "13:59"));
      await setRoutineResponse(t.id, d, t.items.text, { text: "late" }, ny(d, "14:30")); // after the 14:00 cutoff
      await setRoutineReady(t.id, d, true, ny(d, "14:31")); // readiness after the cutoff (allowed operationally)
    });
    expect(await record(t.id, d)).toMatchObject({ status: "INCOMPLETE", requiredDone: 2, requiredTotal: 3, completionPoints: 47, timingPoints: 0, score: 47, readyAt: null });
  });

  it("nothing done → MISSED; a scheduled date with no TradingDay row → MISSED; weekends ignored", async () => {
    const t = await trader("prep-missed");
    await openDay(t, "2026-10-05");
    // Oct 6 (Tue): never opened. Oct 10–11: weekend.
    expect(await finalize(t.id, ny("2026-10-12", "07:00"))).toBe(5);
    const records = await prisma.preparationDayRecord.findMany({ where: { userId: t.id }, orderBy: { date: "asc" } });
    expect(records.map((r) => [r.date.toISOString().slice(0, 10), r.status, r.score])).toEqual([
      ["2026-10-05", "MISSED", 0],
      ["2026-10-06", "MISSED", 0],
      ["2026-10-07", "MISSED", 0],
      ["2026-10-08", "MISSED", 0],
      ["2026-10-09", "MISSED", 0],
    ]);
    // Idempotent: a second run creates nothing.
    expect(await finalize(t.id, ny("2026-10-12", "07:00"))).toBe(0);
    // Before the cutoff today is PENDING and never stored.
    expect((await state(t.id, ny("2026-10-12", "07:00"))).today).toMatchObject({ kind: "PENDING" });
    expect(await record(t.id, "2026-10-12")).toBeNull();
  });

  it("concurrent finalization creates each record exactly once", async () => {
    const t = await trader("prep-concurrent-finalize");
    const now = ny("2026-10-16", "20:00");
    const counts = await runLive(() => Promise.all([1, 2, 3, 4, 5].map(() => finalizePreparationDays(t.id, now))));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(await prisma.preparationDayRecord.count({ where: { userId: t.id } })).toBe(10);
  });

  it("scoring era: no retroactive records; no inferred first-ready or completion times for old days", async () => {
    const t = await trader("prep-era", { schedule: false });
    // A pre-Phase-2-style day: readiness stamped the old way, no scoring facts.
    const old = await runLive(() => getOrCreateTradingDay(t.id, "2026-10-01"));
    await prisma.tradingDay.update({ where: { id: old.id }, data: { routineReadyAt: at("2026-10-01T12:00:00Z"), prepCompletedAt: at("2026-10-01T12:00:00Z") } });
    await confirmPreparationSchedule(t.id, { targetMinutes: 480, weekdays: [1, 2, 3, 4, 5] }, at("2026-10-04T15:00:00Z"));
    await finalize(t.id, ny("2026-10-06", "07:00"));
    const dates = (await prisma.preparationDayRecord.findMany({ where: { userId: t.id } })).map((r) => r.date.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-10-05"]);
    const day = (await runLive(() => getTradingDay(t.id, "2026-10-01")))!;
    expect([day.routineFirstReadyAt, day.routineScoringRequirements]).toEqual([null, null]);
  });
});

// ── Exceptions ──────────────────────────────────────────────────────────────

describe("exceptions", () => {
  it("DAY_OFF before the target exempts the day; at exactly the target it is refused; EXTRA_DAY schedules a Saturday", async () => {
    const t = await trader("prep-exceptions");
    await addPreparationException(t.id, "2026-10-06", "DAY_OFF", minutes(ny("2026-10-06", "08:00"), -1));
    await expect(addPreparationException(t.id, "2026-10-07", "DAY_OFF", ny("2026-10-07", "08:00"))).rejects.toThrow(/before that day's target/);
    await expect(addPreparationException(t.id, "2026-10-10", "DAY_OFF", ny("2026-10-09", "08:00"))).rejects.toThrow(/isn't a scheduled/);
    await addPreparationException(t.id, "2026-10-10", "EXTRA_DAY", ny("2026-10-09", "20:00"));
    await expect(addPreparationException(t.id, "2026-10-11", "EXTRA_DAY", ny("2026-10-11", "09:00"))).rejects.toThrow(/before that day's target/);

    for (const d of ["2026-10-05", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]) await prepare(t, d, ny(d, "07:55"));
    await finalize(t.id, ny("2026-10-12", "07:00"));
    const rows = await prisma.preparationDayRecord.findMany({ where: { userId: t.id }, orderBy: { date: "asc" } });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.status])).toEqual([
      ["2026-10-05", "ON_TIME"],
      ["2026-10-06", "DAY_OFF"],
      ["2026-10-07", "ON_TIME"],
      ["2026-10-08", "ON_TIME"],
      ["2026-10-09", "ON_TIME"],
      ["2026-10-10", "ON_TIME"],
    ]);
    expect((await state(t.id, ny("2026-10-12", "07:00"))).streak.current).toBe(5);
  });

  it("8. a late DAY_OFF cannot erase a scheduled day (inserted directly, it still doesn't count)", async () => {
    const t = await trader("prep-late-dayoff");
    await prisma.preparationDayException.create({ data: { userId: t.id, date: new Date("2026-10-05T00:00:00Z"), kind: "DAY_OFF", createdAt: ny("2026-10-05", "09:00") } });
    await finalize(t.id, ny("2026-10-06", "07:00"));
    expect((await record(t.id, "2026-10-05"))?.status).toBe("MISSED");
  });
});

// ── Immutability, timezone, history ────────────────────────────────────────

describe("immutability", () => {
  it("7/11. finalized records never change: reopening the day, editing it, a timezone change or a new schedule", async () => {
    const t = await trader("prep-record-immutable");
    const d = "2026-10-05";
    await prepare(t, d, ny(d, "07:55"));
    const before = await record(t.id, d);
    await runLive(async () => {
      await endDay(t.id, d);
      await reopenDay(t.id, d);
      await setRoutineReady(t.id, d, false, ny(d, "16:00"));
      await setRoutineResponse(t.id, d, t.items.a, { checked: false }, ny(d, "16:01"));
    });
    await setTraderTimezone(t.id, "Asia/Tokyo", ny(d, "16:02"));
    await confirmPreparationSchedule(t.id, { timezone: "Asia/Tokyo", targetMinutes: 9 * 60, weekdays: [1, 2, 3, 4, 5] }, ny(d, "16:03"));
    await finalize(t.id, ny("2026-10-08", "20:00"));
    expect(await record(t.id, d)).toEqual(before);
    expect(before).toMatchObject({ timezone: NY, targetAt: ny(d, "08:00"), cutoffAt: ny(d, "14:00") });
    await expect(prisma.preparationDayRecord.update({ where: { id: before!.id }, data: { score: 0, completionPoints: 0, timingPoints: 0, status: "MISSED" } })).rejects.toThrow(/PREPARATION_IMMUTABLE/);
    await expect(prisma.preparationDayRecord.delete({ where: { id: before!.id } })).rejects.toThrow(/PREPARATION_IMMUTABLE/);
    // The new zone (and its version) governs from the next local date only: Oct 6 onward.
    expect((await record(t.id, "2026-10-06"))?.timezone).toBe("Asia/Tokyo");
    expect((await record(t.id, "2026-10-06"))?.targetAt.toISOString()).toBe("2026-10-06T00:00:00.000Z"); // 09:00 JST
  });
});

// ── Corrections, streak, notice ─────────────────────────────────────────────

describe("corrections, streak and the break notice", () => {
  it("streak survives late completion, breaks on INCOMPLETE and on MISSED; a repeated miss doesn't repeat the notice", async () => {
    const t = await trader("prep-streak");
    await prepare(t, "2026-10-05", ny("2026-10-05", "07:55"));
    await prepare(t, "2026-10-06", ny("2026-10-06", "11:30")); // very late but before the cutoff
    await openDay(t, "2026-10-07");
    await runLive(() => setRoutineResponse(t.id, "2026-10-07", t.items.a, { checked: true }, ny("2026-10-07", "07:00"))); // partial
    let s = await runLive(() => loadPreparationState(t.id, ny("2026-10-08", "07:00")));
    expect(s.streak).toMatchObject({ current: 0, longest: 2, lastBreak: { dateKey: "2026-10-07", status: "INCOMPLETE", endedLength: 2 } });
    expect(s.notice).toMatchObject({ dateKey: "2026-10-07", status: "INCOMPLETE", endedLength: 2, longest: 2 });

    // Oct 8 and 9 missed while the streak is already 0 → no new notice.
    s = await runLive(() => loadPreparationState(t.id, ny("2026-10-12", "07:00")));
    expect(s.notice?.dateKey).toBe("2026-10-07");
    await acknowledgePreparationNotice(t.id, s.notice!.recordId, ny("2026-10-12", "07:01"));
    s = await state(t.id, ny("2026-10-12", "07:02"));
    expect([s.notice, s.streak.longest]).toEqual([null, 2]);
    // Acknowledgment is written once and touches nothing else.
    const acked = await record(t.id, "2026-10-07");
    await expect(prisma.preparationDayRecord.update({ where: { id: acked!.id }, data: { noticeAcknowledgedAt: new Date() } })).rejects.toThrow(/once/);

    // A new streak, then a MISSED day breaks it and produces a fresh notice.
    await prepare(t, "2026-10-12", ny("2026-10-12", "07:50"));
    s = await state(t.id, ny("2026-10-12", "09:00"));
    expect([s.streak.current, s.streak.restartedAfterBreak, s.today.kind]).toEqual([1, true, "SCORED"]);
    s = await runLive(() => loadPreparationState(t.id, ny("2026-10-14", "07:00"))); // Oct 13 missed
    expect(s.notice).toMatchObject({ dateKey: "2026-10-13", status: "MISSED", endedLength: 1 });
  });

  it("12. corrections are audited and append-only; the read model uses the latest valid one; the record never changes", async () => {
    const t = await trader("prep-correction");
    await prepare(t, "2026-10-05", ny("2026-10-05", "07:55"));
    await openDay(t, "2026-10-06"); // missed
    await prepare(t, "2026-10-07", ny("2026-10-07", "07:55"));
    await finalize(t.id, ny("2026-10-08", "07:00"));
    const missed = (await record(t.id, "2026-10-06"))!;
    expect((await state(t.id, ny("2026-10-08", "07:00"))).streak.current).toBe(1);

    await expect(addPreparationCorrection(missed.id, { status: "DAY_OFF", score: 0, reason: " ", actor: "admin:1" })).rejects.toThrow(/reason/);
    await expect(
      prisma.preparationDayCorrection.create({ data: { userId: t.id, recordId: missed.id, status: "DAY_OFF", score: 0, reason: "", actor: "admin:1" } }),
    ).rejects.toThrow();
    await addPreparationCorrection(missed.id, { status: "MISSED", score: 0, reason: "first look", actor: "admin:1" }, at("2026-10-08T10:00:00Z"));
    const c = await addPreparationCorrection(missed.id, { status: "DAY_OFF", score: 0, reason: "Exchange outage, verified", actor: "admin:1" }, at("2026-10-08T11:00:00Z"));
    const s = await state(t.id, ny("2026-10-08", "07:00"));
    expect([s.streak.current, s.streak.lastBreak]).toEqual([2, null]);
    expect(await record(t.id, "2026-10-06")).toEqual(missed);
    await expect(prisma.preparationDayCorrection.update({ where: { id: c.id }, data: { reason: "edited" } })).rejects.toThrow(/PREPARATION_IMMUTABLE/);
  });
});

// ── Backtesting / Today ─────────────────────────────────────────────────────

describe("isolation and Today integration", () => {
  it("backtest days never feed Preparation, and finalization is a no-op inside a backtest scope", async () => {
    const t = await trader("prep-backtest");
    const run = await createBacktestRun(
      t.id,
      createBacktestRunSchema.parse({ name: "Prep iso", assets: ["XAUUSD"], startDate: "2026-10-01", endDate: "2026-10-31" }),
    );
    await runInBacktestRun(t.id, run.id, async () => {
      const day = await getOrCreateTradingDay(t.id, "2026-10-05");
      await getOrCreateDayRoutine(t.id, day);
      for (const id of [t.items.a, t.items.b]) await setRoutineResponse(t.id, "2026-10-05", id, { checked: true }, ny("2026-10-05", "07:00"));
      await setRoutineResponse(t.id, "2026-10-05", t.items.text, { text: "sim" }, ny("2026-10-05", "07:00"));
      await setRoutineReady(t.id, "2026-10-05", true, ny("2026-10-05", "07:30"));
      expect(await finalizePreparationDays(t.id, ny("2026-10-06", "07:00"))).toBe(0);
    });
    expect(await prisma.preparationDayRecord.count({ where: { userId: t.id } })).toBe(0);
    await finalize(t.id, ny("2026-10-06", "07:00"));
    expect((await record(t.id, "2026-10-05"))?.status).toBe("MISSED"); // the simulated day was never read
  });

  it("the Today loader finalizes and returns the read model; with no schedule it is unconfigured", async () => {
    const t = await trader("prep-today");
    const d = "2026-10-05";
    await prepare(t, d, ny(d, "07:55"));
    const data = await loadTradingWorkspace(t.id, "2026-10-06", { environment: "LIVE" });
    expect(data.preparation).toMatchObject({ configured: true, streak: { current: 1 } });
    expect(data.routine.snapshot.sections.length).toBeGreaterThan(0);

    const none = await trader("prep-today-none", { schedule: false });
    const plain = await loadTradingWorkspace(none.id, "2026-10-06", { environment: "LIVE" });
    expect(plain.preparation).toMatchObject({ configured: false });
    expect(await prisma.preparationDayRecord.count({ where: { userId: none.id } })).toBe(0);
  });
});
