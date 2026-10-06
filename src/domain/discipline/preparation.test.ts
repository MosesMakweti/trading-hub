import { describe, expect, it } from "vitest";

import {
  PREPARATION_SCORING_V1,
  dayApplicability,
  dayInstants,
  derivePreparationStreak,
  effectiveDays,
  evaluatePreparationDays,
  nextEffectiveDate,
  scheduleVersionFor,
  scorePreparationDay,
  timingBandFor,
  validateScheduleVersion,
  validateScoringRules,
  type DayOutcome,
  type EffectiveDay,
  type PreparationDayFacts,
  type PreparationScheduleVersion,
  type PreparationScoreBreakdown,
} from "@/domain/discipline";

/** Preparation Score / Streak — Phase 1 pure domain. */

const at = (iso: string) => new Date(iso);
const MIN = 60_000;

/** New York, 08:00, Mon–Fri, from Mon 2026-10-05. */
const NY: PreparationScheduleVersion = {
  id: "v1",
  effectiveFrom: "2026-10-05",
  timezone: "America/New_York",
  targetMinutes: 480,
  weekdays: [1, 2, 3, 4, 5],
  rules: PREPARATION_SCORING_V1,
  createdAt: at("2026-10-04T12:00:00Z"),
};

const facts = (firstReadyAt: Date | null, required: (Date | null)[] = [null]): PreparationDayFacts => ({
  firstReadyAt,
  requiredItems: required.map((completedAt, i) => ({ id: `i${i}`, completedAt })),
});

function score(dateKey: string, ready: Date | null, required: (Date | null)[], now: Date, version = NY) {
  return scorePreparationDay(version.rules, dayInstants(version, dateKey), facts(ready, required), now);
}

const scored = (r: ReturnType<typeof score>) => {
  if (r.status === "PENDING") throw new Error("pending");
  return r as PreparationScoreBreakdown;
};

describe("rules and schedule validation", () => {
  it("v1 rules are valid and total 100", () => {
    expect(validateScoringRules(PREPARATION_SCORING_V1)).toEqual([]);
    expect(PREPARATION_SCORING_V1.completionMax + PREPARATION_SCORING_V1.timingMax).toBe(100);
  });

  it("schedule versions validate timezone, target, weekdays", () => {
    expect(validateScheduleVersion(NY)).toEqual([]);
    expect(validateScheduleVersion({ ...NY, timezone: "Nowhere/City", targetMinutes: 1440, weekdays: [] }).length).toBe(3);
    expect(validateScheduleVersion({ ...NY, weekdays: [1, 1] })).toContain("weekdays must be distinct values 0–6.");
  });
});

describe("target and cutoff instants (timezone + DST)", () => {
  it("08:00 New York is 12:00Z in summer and 13:00Z in winter; cutoff is +6h", () => {
    const summer = dayInstants(NY, "2026-10-05");
    expect([summer.targetAt.toISOString(), summer.cutoffAt.toISOString()]).toEqual(["2026-10-05T12:00:00.000Z", "2026-10-05T18:00:00.000Z"]);
    const winter = dayInstants(NY, "2026-11-02");
    expect([winter.targetAt.toISOString(), winter.cutoffAt.toISOString()]).toEqual(["2026-11-02T13:00:00.000Z", "2026-11-02T19:00:00.000Z"]);
  });

  it("DST spring transition day: target and cutoff stay deterministic on the same local date", () => {
    const sunday: PreparationScheduleVersion = { ...NY, effectiveFrom: "2026-03-01", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const i = dayInstants(sunday, "2026-03-08");
    expect(i.targetAt.toISOString()).toBe("2026-03-08T12:00:00.000Z"); // 08:00 EDT
    expect(i.cutoffAt.getTime() - i.targetAt.getTime()).toBe(360 * MIN);
    const early = dayInstants({ ...sunday, targetMinutes: 60 }, "2026-03-08"); // 01:00 EST, before the gap
    expect(early.targetAt.toISOString()).toBe("2026-03-08T06:00:00.000Z");
  });

  it("DST fall transition day: 08:00 is after the repeat hour and unambiguous", () => {
    const sunday: PreparationScheduleVersion = { ...NY, effectiveFrom: "2026-10-01", weekdays: [0] };
    const i = dayInstants(sunday, "2026-11-01");
    expect(i.targetAt.toISOString()).toBe("2026-11-01T13:00:00.000Z"); // 08:00 EST
  });

  it("the cutoff is capped at 23:59 local", () => {
    const late = dayInstants({ ...NY, targetMinutes: 20 * 60 }, "2026-10-05"); // 20:00 → 02:00 would cross midnight
    expect(late.cutoffAt.toISOString()).toBe("2026-10-06T03:59:00.000Z"); // 23:59 EDT
  });

  it("the trader's local date, not UTC, identifies the day", () => {
    // 21:30 New York on Mon Oct 5 is already Oct 6 in UTC — it still belongs to Oct 5.
    // It is judged against Oct 5's 08:00 target / 14:00 cutoff (18:00Z) — so it is past the cutoff.
    const r = scored(score("2026-10-05", at("2026-10-06T01:30:00Z"), [at("2026-10-05T17:00:00Z")], at("2026-10-06T02:00:00Z")));
    expect([r.status, r.completionPoints, r.timingPoints]).toEqual(["INCOMPLETE", 70, 0]);
    // Under a UTC calendar the same instant would have been Oct 6 — a different day entirely.
    expect(dayInstants({ ...NY, timezone: "UTC" }, "2026-10-06").targetAt.toISOString()).toBe("2026-10-06T08:00:00.000Z");
  });
});

describe("timing bands — exactly at every boundary", () => {
  const T = dayInstants(NY, "2026-10-05").targetAt.getTime();
  const after = (m: number, s = 0) => new Date(T + m * MIN + s * 1000);
  const cases: [string, Date, number, string][] = [
    ["T−3h − 1s → very early", after(-180, -1), 15, "VERY_EARLY"],
    ["T−3h exactly → early", after(-180), 25, "EARLY"],
    ["T−60m − 1s → early", after(-60, -1), 25, "EARLY"],
    ["T−60m exactly → on time", after(-60), 30, "ON_TIME"],
    ["T exactly → on time", after(0), 30, "ON_TIME"],
    ["T+15m exactly → on time", after(15), 30, "ON_TIME"],
    ["T+15m + 1s → late 25", after(15, 1), 25, "LATE"],
    ["T+30m exactly → late 25", after(30), 25, "LATE"],
    ["T+30m + 1s → late 18", after(30, 1), 18, "LATE"],
    ["T+60m exactly → late 18", after(60), 18, "LATE"],
    ["T+60m + 1s → very late 10", after(60, 1), 10, "VERY_LATE"],
    ["T+2h exactly → very late 10", after(120), 10, "VERY_LATE"],
    ["T+2h + 1s → very late 5", after(120, 1), 5, "VERY_LATE"],
    ["cutoff exactly → very late 5", after(360), 5, "VERY_LATE"],
  ];
  for (const [name, ready, points, status] of cases) {
    it(name, () => {
      const r = scored(score("2026-10-05", ready, [ready], at("2026-10-05T23:00:00Z")));
      expect([r.timingPoints, r.status, r.completionPoints, r.score]).toEqual([points, status, 70, 70 + points]);
    });
  }

  it("one second after the cutoff → not counted (INCOMPLETE), timing 0", () => {
    const r = scored(score("2026-10-05", after(360, 1), [after(0)], at("2026-10-05T23:00:00Z")));
    expect([r.status, r.timingPoints, r.completionPoints, r.score]).toEqual(["INCOMPLETE", 0, 70, 70]);
  });

  it("bands never overlap: a sweep from T−5h to the cutoff hits exactly one band per second", () => {
    let prevPoints = -1;
    for (let s = -300 * 60; s <= 360 * 60; s += 7) {
      const band = timingBandFor(PREPARATION_SCORING_V1, s * 1000);
      expect(band).toBeDefined();
      if (s >= 15 * 60) expect(band.points <= (prevPoints < 0 ? 30 : prevPoints)).toBe(true); // non-increasing after on-time
      if (s >= 15 * 60) prevPoints = band.points;
    }
  });

  it("explains itself: deviation minutes and band label", () => {
    const r = scored(score("2026-10-05", after(17), [after(10)], at("2026-10-05T23:00:00Z")));
    expect([r.score, r.completionPoints, r.timingPoints, r.deviationMinutes, r.bandLabel]).toEqual([95, 70, 25, 17, "Late"]);
    const early = scored(score("2026-10-05", after(-10), [after(-20)], at("2026-10-05T23:00:00Z")));
    expect([early.deviationMinutes, early.status, early.score]).toEqual([-10, "ON_TIME", 100]);
  });

  it("preparing on a previous date (future-day preparation) still only earns the very-early band", () => {
    const r = scored(score("2026-10-05", at("2026-10-04T22:00:00Z"), [at("2026-10-04T21:00:00Z")], at("2026-10-05T23:00:00Z")));
    expect([r.status, r.score]).toEqual(["VERY_EARLY", 85]);
  });
});

describe("completion", () => {
  const cutoff = dayInstants(NY, "2026-10-05").cutoffAt;
  const before = at("2026-10-05T11:00:00Z");
  const afterCutoff = at("2026-10-05T23:00:00Z");

  it("partial completion by the cutoff → INCOMPLETE with proportional credit", () => {
    const r = scored(score("2026-10-05", null, [before, before, null], afterCutoff));
    expect([r.status, r.requiredDone, r.requiredTotal, r.completionPoints, r.timingPoints, r.score]).toEqual(["INCOMPLETE", 2, 3, 47, 0, 47]);
  });

  it("items completed after the cutoff never count", () => {
    const r = scored(score("2026-10-05", null, [before, new Date(cutoff.getTime() + 1000)], afterCutoff));
    expect([r.requiredDone, r.completionPoints]).toEqual([1, 35]);
  });

  it("readiness after the cutoff never restores the day", () => {
    const r = scored(score("2026-10-05", new Date(cutoff.getTime() + 60 * MIN), [before, before], afterCutoff));
    expect([r.status, r.score]).toEqual(["INCOMPLETE", 70]);
  });

  it("nothing done → MISSED (0)", () => {
    const r = scored(score("2026-10-05", null, [null, null], afterCutoff));
    expect([r.status, r.score, r.completionPoints]).toEqual(["MISSED", 0, 0]);
  });

  it("zero mandatory items: explicit readiness still required; once confirmed → 70/70", () => {
    const ready = scored(score("2026-10-05", at("2026-10-05T12:05:00Z"), [], afterCutoff));
    expect([ready.requiredTotal, ready.completionPoints, ready.timingPoints, ready.score]).toEqual([0, 70, 30, 100]);
    const notReady = scored(score("2026-10-05", null, [], afterCutoff));
    expect([notReady.status, notReady.score]).toEqual(["MISSED", 0]);
  });

  it("before the cutoff without readiness → PENDING, never a miss", () => {
    const r = score("2026-10-05", null, [before, null], at("2026-10-05T11:35:00Z"));
    expect(r).toMatchObject({ status: "PENDING", final: false, requiredDone: 1, requiredTotal: 2, minutesToTarget: 25 });
    expect(score("2026-10-05", null, [null], cutoff).status).toBe("PENDING"); // the cutoff instant itself is still open
  });

  it("readiness before the cutoff is final immediately", () => {
    const r = score("2026-10-05", at("2026-10-05T12:20:00Z"), [before], at("2026-10-05T12:21:00Z"));
    expect(r).toMatchObject({ final: true, status: "LATE", score: 95 });
  });
});

describe("schedule applicability — weekdays, exceptions, era", () => {
  it("weekdays: Mon–Fri scheduled, Saturday not", () => {
    expect(dayApplicability([NY], [], "2026-10-05").kind).toBe("SCHEDULED");
    expect(dayApplicability([NY], [], "2026-10-10").kind).toBe("NOT_SCHEDULED");
  });

  it("no retroactive scoring: before effectiveFrom is outside the era", () => {
    expect(dayApplicability([NY], [], "2026-10-02").kind).toBe("OUTSIDE_ERA");
    expect(scheduleVersionFor([], "2026-10-05")).toBeNull();
  });

  it("DAY_OFF counts only when created before that day's target", () => {
    const target = dayInstants(NY, "2026-10-06").targetAt;
    const inAdvance = { dateKey: "2026-10-06", kind: "DAY_OFF" as const, createdAt: new Date(target.getTime() - 1000) };
    const late = { dateKey: "2026-10-06", kind: "DAY_OFF" as const, createdAt: new Date(target.getTime()) };
    expect(dayApplicability([NY], [inAdvance], "2026-10-06").kind).toBe("DAY_OFF");
    expect(dayApplicability([NY], [late], "2026-10-06").kind).toBe("SCHEDULED");
  });

  it("EXTRA_DAY makes a normally unscheduled date count", () => {
    const a = dayApplicability([NY], [{ dateKey: "2026-10-10", kind: "EXTRA_DAY", createdAt: at("2026-10-01T00:00:00Z") }], "2026-10-10");
    expect(a).toMatchObject({ kind: "SCHEDULED", viaExtraDay: true });
    // Created at/after that date's target it is too late — it cannot pad a streak retroactively.
    const tooLate = { dateKey: "2026-10-10", kind: "EXTRA_DAY" as const, createdAt: dayInstants(NY, "2026-10-10").targetAt };
    expect(dayApplicability([NY], [tooLate], "2026-10-10").kind).toBe("NOT_SCHEDULED");
  });

  it("a new version governs only from its effectiveFrom; earlier dates keep the old target", () => {
    const v2: PreparationScheduleVersion = { ...NY, id: "v2", effectiveFrom: nextEffectiveDate("2026-10-06"), targetMinutes: 9 * 60, createdAt: at("2026-10-06T15:00:00Z") };
    expect(v2.effectiveFrom).toBe("2026-10-07");
    expect(dayInstants(scheduleVersionFor([NY, v2], "2026-10-06")!, "2026-10-06").targetAt.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(dayInstants(scheduleVersionFor([NY, v2], "2026-10-07")!, "2026-10-07").targetAt.toISOString()).toBe("2026-10-07T13:00:00.000Z");
  });

  it("a timezone change in a later version never shifts earlier dates", () => {
    const tokyo: PreparationScheduleVersion = { ...NY, id: "v3", effectiveFrom: "2026-10-08", timezone: "Asia/Tokyo", createdAt: at("2026-10-07T00:00:00Z") };
    expect(dayInstants(scheduleVersionFor([NY, tokyo], "2026-10-07")!, "2026-10-07").targetAt.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(dayInstants(scheduleVersionFor([NY, tokyo], "2026-10-08")!, "2026-10-08").targetAt.toISOString()).toBe("2026-10-07T23:00:00.000Z");
  });
});

// ── Multi-day evaluation + streak ───────────────────────────────────────────

function readyAt(dateKey: string, offsetMin: number): PreparationDayFacts {
  const t = dayInstants(NY, dateKey).targetAt.getTime() + offsetMin * MIN;
  return facts(new Date(t), [new Date(t - MIN)]);
}

function statuses(outcomes: DayOutcome[]) {
  return outcomes.map((o) => [o.dateKey, o.kind === "SCORED" ? o.breakdown.status : o.kind === "PENDING" ? "PENDING" : o.status]);
}

describe("evaluation across dates", () => {
  it("one outcome per local date from the era start through today; a scheduled date with no TradingDay row is MISSED", () => {
    const facts = new Map<string, PreparationDayFacts>([
      ["2026-10-05", readyAt("2026-10-05", 0)],
      // 2026-10-06: no TradingDay row at all
      ["2026-10-07", readyAt("2026-10-07", 25)],
    ]);
    const out = evaluatePreparationDays({ versions: [NY], exceptions: [], facts, todayKey: "2026-10-08", now: at("2026-10-08T11:00:00Z") });
    expect(statuses(out)).toEqual([
      ["2026-10-05", "ON_TIME"],
      ["2026-10-06", "MISSED"],
      ["2026-10-07", "LATE"],
      ["2026-10-08", "PENDING"],
    ]);
  });

  it("no schedule → nothing is scored; fromDateKey resumes after the last persisted record", () => {
    expect(evaluatePreparationDays({ versions: [], exceptions: [], facts: new Map(), todayKey: "2026-10-08", now: at("2026-10-08T11:00:00Z") })).toEqual([]);
    const resumed = evaluatePreparationDays({ versions: [NY], exceptions: [], facts: new Map(), todayKey: "2026-10-07", now: at("2026-10-08T00:00:00Z"), fromDateKey: "2026-10-07" });
    expect(statuses(resumed)).toEqual([["2026-10-07", "MISSED"]]);
  });
});

function day(dateKey: string, status: EffectiveDay["status"]): EffectiveDay {
  return { dateKey, status, score: null, corrected: false };
}

describe("Preparation Streak", () => {
  it("late completion before the cutoff preserves the streak", () => {
    const s = derivePreparationStreak([day("2026-10-05", "ON_TIME"), day("2026-10-06", "VERY_LATE"), day("2026-10-07", "LATE")]);
    expect([s.current, s.longest, s.lastBreak]).toEqual([3, 3, null]);
  });

  it("a missed scheduled day breaks the streak; the next completed day starts a new one", () => {
    const s = derivePreparationStreak([
      day("2026-10-05", "ON_TIME"),
      day("2026-10-06", "ON_TIME"),
      day("2026-10-07", "MISSED"),
      day("2026-10-08", "EARLY"),
    ]);
    expect([s.current, s.longest]).toEqual([1, 2]);
    expect(s.lastBreak).toEqual({ dateKey: "2026-10-07", status: "MISSED", endedLength: 2 });
    expect(s.restartedAfterBreak).toBe(true);
  });

  it("INCOMPLETE breaks the streak too", () => {
    expect(derivePreparationStreak([day("2026-10-05", "ON_TIME"), day("2026-10-06", "INCOMPLETE")]).current).toBe(0);
  });

  it("weekends, non-scheduled days and planned days off don't break the streak", () => {
    const s = derivePreparationStreak([
      day("2026-10-09", "ON_TIME"),
      day("2026-10-10", "NOT_SCHEDULED"),
      day("2026-10-11", "NOT_SCHEDULED"),
      day("2026-10-12", "DAY_OFF"),
      day("2026-10-13", "ON_TIME"),
    ]);
    expect([s.current, s.longest]).toEqual([2, 2]);
  });

  it("today pending before its cutoff neither counts nor breaks", () => {
    const s = derivePreparationStreak([day("2026-10-05", "ON_TIME"), day("2026-10-06", "ON_TIME"), day("2026-10-07", "PENDING")]);
    expect(s.current).toBe(2);
  });

  it("longest streak is tracked across breaks; input order doesn't matter", () => {
    const days = [
      ...["05", "06", "07", "08", "09"].map((d) => day(`2026-10-${d}`, "ON_TIME" as const)),
      day("2026-10-12", "MISSED"),
      day("2026-10-13", "ON_TIME"),
      day("2026-10-14", "ON_TIME"),
    ];
    const s = derivePreparationStreak([...days].reverse());
    expect([s.current, s.longest]).toEqual([2, 5]);
  });

  it("a break when no streak was running is not announced", () => {
    const s = derivePreparationStreak([day("2026-10-05", "MISSED"), day("2026-10-06", "MISSED")]);
    expect([s.current, s.longest, s.lastBreak]).toEqual([0, 0, null]);
  });

  it("end-to-end: a full week, Saturday exempt, Monday missed", () => {
    const facts = new Map<string, PreparationDayFacts>(
      ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-13"].map((d) => [d, readyAt(d, 5)]),
    );
    const out = evaluatePreparationDays({ versions: [NY], exceptions: [], facts, todayKey: "2026-10-14", now: at("2026-10-14T11:00:00Z") });
    const s = derivePreparationStreak(effectiveDays(out, []));
    // Mon 12 missed (no row), Tue 13 on time, Wed 14 pending.
    expect([s.current, s.longest, s.lastBreak?.dateKey, s.lastBreak?.endedLength]).toEqual([1, 5, "2026-10-12", 5]);
  });
});

describe("corrections (append-only, latest valid wins)", () => {
  it("a correction overrides the effective outcome without touching the original", () => {
    const out = evaluatePreparationDays({
      versions: [NY],
      exceptions: [],
      facts: new Map([["2026-10-05", readyAt("2026-10-05", 0)]]),
      todayKey: "2026-10-07",
      now: at("2026-10-08T00:00:00Z"),
    });
    const corrections = [
      { dateKey: "2026-10-06", status: "DAY_OFF" as const, score: 0, reason: "Exchange outage, verified", actor: "admin:1", createdAt: at("2026-10-07T09:00:00Z") },
      { dateKey: "2026-10-06", status: "MISSED" as const, score: 0, reason: "superseded", actor: "admin:1", createdAt: at("2026-10-07T08:00:00Z") },
      { dateKey: "2026-10-07", status: "ON_TIME" as const, score: 100, reason: "", actor: "admin:1", createdAt: at("2026-10-08T09:00:00Z") }, // no reason → ignored
    ];
    const eff = effectiveDays(out, corrections);
    expect(eff.map((d) => [d.dateKey, d.status, d.corrected])).toEqual([
      ["2026-10-05", "ON_TIME", false],
      ["2026-10-06", "DAY_OFF", true],
      ["2026-10-07", "MISSED", false],
    ]);
    expect(out.find((o) => o.dateKey === "2026-10-06")).toMatchObject({ kind: "SCORED", breakdown: { status: "MISSED" } });
    expect(derivePreparationStreak(eff).current).toBe(1 - 1); // Oct 7 missed after the corrected exempt day
  });
});
