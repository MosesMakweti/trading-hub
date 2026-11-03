import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_STREAK_THRESHOLDS,
  buildDisciplineDays,
  dateKeysBetween,
  deriveDailyStreak,
  evaluateAchievements,
  evaluatePlanAdherence,
  evaluateRoutineDay,
  milestoneAt,
  milestoneProgress,
  routineDayRequirement,
  skippedDateKeys,
  streakRuns,
  trackSeries,
  traderDateKeyOf,
  type DayRequirement,
  type PlanAdherenceFacts,
  type RoutineDayEvaluation,
  type StreakDay,
  type TrackInputs,
} from "./index";
import { PREPARATION_SCORING_V1 } from "../preparation-config";
import type { PreparationScheduleVersion } from "../preparation-schedule";

const days = (spec: string, start = "2026-01-05"): StreakDay[] => {
  // A=ACTIVE M=MISSED R=REST P=PENDING, one char per consecutive date.
  const map = { A: "ACTIVE", M: "MISSED", R: "REST", P: "PENDING" } as const;
  const keys = dateKeysBetween(start, "2030-01-01").slice(0, spec.length);
  return [...spec].map((c, i) => ({ dateKey: keys[i], status: map[c as keyof typeof map] }));
};

describe("deriveDailyStreak", () => {
  it("counts consecutive active days and resets on a miss (the brief's Day 1–5 example)", () => {
    const s = deriveDailyStreak(days("AAAMA"));
    expect(s.current).toBe(1);
    expect(s.longest).toBe(3);
    expect(s.longestEndedOn).toBe("2026-01-07");
    expect(s.lastBreak).toEqual({ dateKey: "2026-01-08", endedLength: 3 });
    expect(s.activeDays).toBe(4);
  });

  it("progresses day by day", () => {
    expect(deriveDailyStreak(days("A")).current).toBe(1);
    expect(deriveDailyStreak(days("AA")).current).toBe(2);
    expect(deriveDailyStreak(days("AAA")).current).toBe(3);
  });

  it("REST and PENDING never break a streak", () => {
    const s = deriveDailyStreak(days("AARRARPA"));
    expect(s.current).toBe(4);
    expect(s.currentStartedOn).toBe("2026-01-05");
  });

  it("starts at zero with no data and after repeated misses", () => {
    expect(deriveDailyStreak([]).current).toBe(0);
    const s = deriveDailyStreak(days("MMM"));
    expect(s.current).toBe(0);
    expect(s.lastBreak).toBeNull(); // nothing was ended
  });

  it("records the first date each threshold was reached", () => {
    const s = deriveDailyStreak(days("AAAMAAAAAAA"), [3, 7]);
    expect(s.reachedOn[3]).toBe("2026-01-07");
    expect(s.reachedOn[7]).toBe("2026-01-15");
  });

  it("rejects duplicate or unsorted dates so a day can never count twice", () => {
    expect(() => deriveDailyStreak([{ dateKey: "2026-01-05", status: "ACTIVE" }, { dateKey: "2026-01-05", status: "ACTIVE" }])).toThrow(RangeError);
  });

  it("lists runs", () => {
    expect(streakRuns(days("AAMRAA")).map((r) => r.length)).toEqual([2, 2]);
  });
});

describe("evaluateRoutineDay", () => {
  const base = { dateKey: "2026-03-02", readyDateKey: "2026-03-02", closedDateKey: "2026-03-02", hasReflection: true };

  it("complete only when pre-session AND post-session are done", () => {
    expect(evaluateRoutineDay(base).complete).toBe(true);
    expect(evaluateRoutineDay({ ...base, readyDateKey: null }).complete).toBe(false);
    expect(evaluateRoutineDay({ ...base, closedDateKey: null }).complete).toBe(false);
  });

  it("an incomplete routine (no readiness, so required items not all done) never counts", () => {
    const e = evaluateRoutineDay({ ...base, readyDateKey: null });
    expect(e).toEqual({ preSession: false, postSession: true, complete: false });
  });

  it("closing without a written reflection is not a full post-session routine", () => {
    expect(evaluateRoutineDay({ ...base, hasReflection: false }).postSession).toBe(false);
  });

  it("allows journaling after midnight but not back-filling later", () => {
    expect(evaluateRoutineDay({ ...base, closedDateKey: "2026-03-03" }).complete).toBe(true);
    expect(evaluateRoutineDay({ ...base, closedDateKey: "2026-03-04" }).complete).toBe(false);
    expect(evaluateRoutineDay({ ...base, readyDateKey: "2026-03-03" }).complete).toBe(false);
  });
});

describe("routineDayRequirement", () => {
  const version = (weekdays: number[], effectiveFrom = "2026-01-01"): PreparationScheduleVersion => ({
    id: "v1",
    effectiveFrom,
    timezone: "UTC",
    targetMinutes: 8 * 60,
    weekdays,
    rules: PREPARATION_SCORING_V1,
    createdAt: new Date("2025-12-31T00:00:00Z"),
  });

  it("defaults to Monday–Friday without a schedule", () => {
    expect(routineDayRequirement([], [], "2026-03-02")).toBe("REQUIRED"); // Monday
    expect(routineDayRequirement([], [], "2026-03-07")).toBe("OPTIONAL"); // Saturday
  });

  it("follows the trader's Preparation Schedule and advance DAY_OFFs only", () => {
    const v = [version([0, 1, 2, 3, 4])]; // Sun–Thu
    expect(routineDayRequirement(v, [], "2026-03-01")).toBe("REQUIRED"); // Sunday
    expect(routineDayRequirement(v, [], "2026-03-06")).toBe("OPTIONAL"); // Friday
    const early = { dateKey: "2026-03-02", kind: "DAY_OFF" as const, createdAt: new Date("2026-02-28T00:00:00Z") };
    const late = { dateKey: "2026-03-03", kind: "DAY_OFF" as const, createdAt: new Date("2026-03-03T12:00:00Z") };
    expect(routineDayRequirement(v, [early], "2026-03-02")).toBe("EXEMPT");
    expect(routineDayRequirement(v, [late], "2026-03-03")).toBe("REQUIRED"); // too late to erase a miss
  });
});

const perfect: PlanAdherenceFacts = {
  executed: true,
  reviewComplete: true,
  adherenceAnswers: { followedStrategy: true, followedEntryModel: true, followedTradeManagement: true, remainedPatient: true },
  tradeIntent: "PLANNED",
  setupValid: true,
  validationState: "VALIDATED",
  hasLimitOverride: false,
  biasAlignment: "ALIGNED",
  stopWidened: false,
  riskManaged: "yes",
  followedExitPlan: "yes",
};

describe("evaluatePlanAdherence", () => {
  it("a fully compliant trade is PERFECT — no outcome input exists at all", () => {
    expect(evaluatePlanAdherence(perfect).status).toBe("PERFECT");
    // Outcome is not part of the facts: a losing trade and a winning trade with
    // identical process facts evaluate identically.
    expect(Object.keys(perfect)).not.toEqual(expect.arrayContaining(["realizedR", "pnl", "win"]));
  });

  it("any single 'No' process answer disqualifies (a profitable rule-break never qualifies)", () => {
    for (const key of Object.keys(perfect.adherenceAnswers)) {
      const r = evaluatePlanAdherence({ ...perfect, adherenceAnswers: { ...perfect.adherenceAnswers, [key]: false } });
      expect(r.status).toBe("VIOLATED");
      expect(r.violations[0].key).toBe(`adherence.${key}`);
    }
  });

  it("objective violations disqualify even before the review is done", () => {
    const cases: Partial<PlanAdherenceFacts>[] = [
      { setupValid: false },
      { validationState: "OVERRIDDEN" },
      { hasLimitOverride: true },
      { biasAlignment: "CONFLICT" },
      { stopWidened: true },
      { tradeIntent: "FOMO" },
      { tradeIntent: "REVENGE" },
      { tradeIntent: "MANUAL_OVERRIDE" },
    ];
    for (const c of cases) expect(evaluatePlanAdherence({ ...perfect, reviewComplete: false, ...c }).status).toBe("VIOLATED");
  });

  it("no adherence credit without the trader's completed review", () => {
    expect(evaluatePlanAdherence({ ...perfect, reviewComplete: false }).status).toBe("AWAITING_REVIEW");
  });

  it("psychology 'No' on risk or exit plan disqualifies; unanswered / unknown bias does not", () => {
    expect(evaluatePlanAdherence({ ...perfect, riskManaged: "no" }).status).toBe("VIOLATED");
    expect(evaluatePlanAdherence({ ...perfect, followedExitPlan: "no" }).status).toBe("VIOLATED");
    expect(evaluatePlanAdherence({ ...perfect, riskManaged: null, followedExitPlan: null, biasAlignment: "UNKNOWN", stopWidened: null, setupValid: null }).status).toBe("PERFECT");
  });

  it("an unexecuted idea is not applicable", () => {
    expect(evaluatePlanAdherence({ ...perfect, executed: false }).status).toBe("NOT_APPLICABLE");
  });
});

const mondayToFriday = (k: string): DayRequirement => routineDayRequirement([], [], k);
const inputs = (over: Partial<TrackInputs>): TrackInputs => ({
  from: "2026-03-02", // Monday
  todayKey: "2026-03-06", // Friday
  requirement: mondayToFriday,
  skipped: new Set(),
  routineDays: new Map(),
  reviews: [],
  adherence: [],
  ...over,
});
const complete: RoutineDayEvaluation = { preSession: true, postSession: true, complete: true };
const partial: RoutineDayEvaluation = { preSession: true, postSession: false, complete: false };

describe("buildDisciplineDays — routine", () => {
  it("full days count; a partial day breaks; today stays pending", () => {
    const d = buildDisciplineDays(
      inputs({ routineDays: new Map([["2026-03-02", complete], ["2026-03-03", complete], ["2026-03-04", partial], ["2026-03-05", complete]]) }),
    );
    expect(d.map((x) => x.routine)).toEqual(["ACTIVE", "ACTIVE", "MISSED", "ACTIVE", "PENDING"]);
    expect(deriveDailyStreak(trackSeries(d, "routine")).current).toBe(1);
  });

  it("weekends and DAY_OFFs are rest, but a completed weekend still counts", () => {
    const d = buildDisciplineDays(
      inputs({
        from: "2026-03-05",
        todayKey: "2026-03-09",
        routineDays: new Map([["2026-03-05", complete], ["2026-03-06", complete], ["2026-03-08", complete], ["2026-03-09", complete]]),
      }),
    );
    expect(d.map((x) => x.routine)).toEqual(["ACTIVE", "ACTIVE", "REST", "ACTIVE", "ACTIVE"]);
    expect(deriveDailyStreak(trackSeries(d, "routine")).current).toBe(4);
  });

  it("is independent of trading: no trades at all, routine streak still builds", () => {
    const d = buildDisciplineDays(inputs({ routineDays: new Map(dateKeysBetween("2026-03-02", "2026-03-06").map((k) => [k, complete])) }));
    expect(deriveDailyStreak(trackSeries(d, "routine")).current).toBe(5);
    expect(d.every((x) => x.adherence === "REST")).toBe(true);
  });

  it("a date skipped by a timezone change is rest, not a miss", () => {
    const d = buildDisciplineDays(
      inputs({ skipped: new Set(["2026-03-03"]), routineDays: new Map([["2026-03-02", complete], ["2026-03-04", complete]]) }),
    );
    expect(d[1].routine).toBe("REST");
    expect(deriveDailyStreak(trackSeries(d.slice(0, 3), "routine")).current).toBe(2);
  });
});

describe("buildDisciplineDays — review", () => {
  it("many reviews on one day add to the lifetime count but only once to the streak", () => {
    const reviews = ["a", "b", "c"].map((id) => ({ tradeId: id, creditDateKey: "2026-03-02", closedDateKey: "2026-03-02" }));
    reviews.push({ tradeId: "d", creditDateKey: "2026-03-03", closedDateKey: "2026-03-03" });
    const d = buildDisciplineDays(inputs({ reviews }));
    expect(d[0].reviewsCompleted).toBe(3);
    expect(deriveDailyStreak(trackSeries(d, "review")).current).toBe(2);
  });

  it("only breaks on a required day when a closed trade was left unreviewed", () => {
    const reviews = [
      { tradeId: "a", creditDateKey: "2026-03-02", closedDateKey: "2026-03-02" },
      { tradeId: "b", creditDateKey: "2026-03-05", closedDateKey: "2026-03-03" }, // waited two days
    ];
    const d = buildDisciplineDays(inputs({ reviews }));
    expect(d.map((x) => x.review)).toEqual(["ACTIVE", "MISSED", "MISSED", "ACTIVE", "PENDING"]);
    expect(d.map((x) => x.reviewsOutstanding)).toEqual([0, 1, 1, 0, 0]);
  });

  it("nothing to review → rest days, so no trade is ever needed to keep the streak", () => {
    const d = buildDisciplineDays(inputs({ reviews: [{ tradeId: "a", creditDateKey: "2026-03-02", closedDateKey: "2026-03-02" }] }));
    expect(d.map((x) => x.review)).toEqual(["ACTIVE", "REST", "REST", "REST", "PENDING"]);
    expect(deriveDailyStreak(trackSeries(d, "review")).current).toBe(1);
  });

  it("reviewing an old trade restores activity without opening a new position", () => {
    const d = buildDisciplineDays(inputs({ reviews: [{ tradeId: "old", creditDateKey: "2026-03-04", closedDateKey: "2026-02-10" }] }));
    expect(d.map((x) => x.review)).toEqual(["MISSED", "MISSED", "ACTIVE", "REST", "PENDING"]);
  });

  it("an un-credited (incomplete) review never counts", () => {
    const d = buildDisciplineDays(inputs({ reviews: [{ tradeId: "a", creditDateKey: null, closedDateKey: "2026-03-02" }] }));
    expect(d.filter((x) => x.review === "ACTIVE")).toHaveLength(0);
  });
});

describe("buildDisciplineDays — adherence", () => {
  const t = (id: string, date: string, status: "PERFECT" | "VIOLATED" | "AWAITING_REVIEW" | "NOT_APPLICABLE") => ({ tradeId: id, tradeDateKey: date, status });

  it("multiple perfect trades on one day count individually but once towards the streak", () => {
    const d = buildDisciplineDays(inputs({ adherence: [t("a", "2026-03-02", "PERFECT"), t("b", "2026-03-02", "PERFECT"), t("c", "2026-03-03", "PERFECT")] }));
    expect(d[0].perfectTrades).toBe(2);
    expect(deriveDailyStreak(trackSeries(d, "adherence")).current).toBe(2);
  });

  it("no-trade days are rest; a day with only violations breaks", () => {
    const d = buildDisciplineDays(
      inputs({ adherence: [t("a", "2026-03-02", "PERFECT"), t("b", "2026-03-04", "VIOLATED"), t("c", "2026-03-05", "PERFECT")] }),
    );
    expect(d.map((x) => x.adherence)).toEqual(["ACTIVE", "REST", "MISSED", "ACTIVE", "REST"]);
    expect(deriveDailyStreak(trackSeries(d, "adherence")).current).toBe(1);
  });

  it("awaiting review is pending — never credited, never a break yet", () => {
    const d = buildDisciplineDays(inputs({ adherence: [t("a", "2026-03-02", "PERFECT"), t("b", "2026-03-03", "AWAITING_REVIEW"), t("c", "2026-03-04", "PERFECT")] }));
    expect(d[1].adherence).toBe("PENDING");
    expect(deriveDailyStreak(trackSeries(d, "adherence")).current).toBe(2);
  });

  it("cancelled ideas never make a trading day", () => {
    const d = buildDisciplineDays(inputs({ adherence: [t("x", "2026-03-02", "NOT_APPLICABLE")] }));
    expect(d[0].adherence).toBe("REST");
  });
});

describe("trader calendar for streaks", () => {
  const v = (timezone: string, at: string) => ({ timezone, effectiveFrom: new Date(at), createdAt: new Date(at) });

  it("places an instant under the zone in effect at that instant", () => {
    const versions = [v("America/New_York", "2026-01-01T05:00:00Z"), v("Asia/Tokyo", "2026-03-01T15:00:00Z")];
    // 23:30 New York on Feb 27 is Feb 28 in UTC, but the trader was in NY.
    expect(traderDateKeyOf(versions, new Date("2026-02-28T04:30:00Z"))).toBe("2026-02-27");
    // After the move, the same wall time lands on Tokyo's calendar.
    expect(traderDateKeyOf(versions, new Date("2026-03-02T16:00:00Z"))).toBe("2026-03-03");
  });

  it("finds the date an eastward jump across the date line skipped", () => {
    // Honolulu (−10) → Kiritimati (+14) at the start of Mar 2 Honolulu time → Mar 3 there.
    const at = "2026-03-02T10:00:00Z";
    const versions = [v("Pacific/Honolulu", "2026-01-01T10:00:00Z"), v("Pacific/Kiritimati", at)];
    expect(traderDateKeyOf(versions, new Date(new Date(at).getTime() - 1))).toBe("2026-03-01");
    expect(traderDateKeyOf(versions, new Date(at))).toBe("2026-03-03");
    expect([...skippedDateKeys(versions, "2026-02-01", "2026-04-01")]).toEqual(["2026-03-02"]);
  });

  it("an ordinary change skips nothing", () => {
    const versions = [v("Europe/London", "2026-01-01T00:00:00Z"), v("Europe/Berlin", "2026-03-01T23:00:00Z")];
    expect(skippedDateKeys(versions, "2026-01-01", "2026-12-31").size).toBe(0);
  });
});

describe("milestones", () => {
  it("tracks progress to the next milestone", () => {
    expect(milestoneProgress(0)).toMatchObject({ target: 3, previous: 0, remaining: 3 });
    expect(milestoneProgress(5)).toMatchObject({ target: 7, previous: 3, remaining: 2, fraction: 0.5 });
    expect(milestoneProgress(90)).toMatchObject({ target: null, previous: 90, fraction: 1 });
    expect(milestoneAt(14)).toBe(14);
    expect(milestoneAt(15)).toBeNull();
  });
});

describe("evaluateAchievements", () => {
  const none = { creditDates: [], longest: 0, streakReachedOn: {} };

  it("is all-locked with no activity", () => {
    expect(evaluateAchievements({ routine: none, review: none, adherence: none }).every((a) => !a.achieved)).toBe(true);
  });

  it("dates count achievements by the N-th credit and streak ones by the day the streak got there", () => {
    const reviews = dateKeysBetween("2026-01-01", "2026-01-30"); // 30 reviews
    const s = deriveDailyStreak(days("AAAAAAA"), ACHIEVEMENT_STREAK_THRESHOLDS);
    const e = evaluateAchievements({
      routine: { creditDates: dateKeysBetween("2026-01-05", "2026-01-11"), longest: s.longest, streakReachedOn: s.reachedOn },
      review: { creditDates: reviews, longest: 1, streakReachedOn: {} },
      adherence: none,
    });
    const by = Object.fromEntries(e.map((a) => [a.key, a]));
    expect(by["routine.first"]).toMatchObject({ achieved: true, achievedOn: "2026-01-05" });
    expect(by["routine.streak7"]).toMatchObject({ achieved: true, achievedOn: "2026-01-11" });
    expect(by["routine.streak30"]).toMatchObject({ achieved: false, progress: 7, target: 30 });
    expect(by["review.total25"]).toMatchObject({ achieved: true, achievedOn: "2026-01-25" });
    expect(by["review.total100"]).toMatchObject({ achieved: false, progress: 30 });
    expect(by["adherence.first"].achieved).toBe(false);
  });

  it("has unique, stable keys and never rewards trade count or profit", () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ACHIEVEMENTS.map((a) => a.description).join(" ")).not.toMatch(/profit|pnl|win|place/i);
  });
});
