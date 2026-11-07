import { describe, expect, it } from "vitest";

import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import { dateKeysBetween } from "@/domain/discipline/streaks/calendar";
import type { DayRequirement } from "@/domain/discipline/streaks/routine-day";
import {
  computeGoalProgress,
  evaluateRequirement,
  progressPercent,
  projectedCompletionDate,
  remainingDays,
  requirementCatalogueEntry,
  requirementSetProblem,
  richTextHasContent,
  type GoalActivityFacts,
  type GoalDayContext,
  type GoalDayRecord,
  type GoalDefinition,
  type GoalTradeFact,
} from "@/domain/goals";

// 2026-03-02 is a Monday.
const MON = "2026-03-02";

/** Monday–Friday trading week. */
const weekdays = (k: string): DayRequirement => {
  const [y, m, d] = k.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6 ? "OPTIONAL" : "REQUIRED";
};
const everyDay = (): DayRequirement => "REQUIRED";
const ctx = (requirement = weekdays, skipped: string[] = []): GoalDayContext => ({ requirement, skipped: new Set(skipped) });

function goal(o: Partial<GoalDefinition> = {}): GoalDefinition {
  return {
    startDate: MON,
    targetDays: 30,
    requirements: [
      { id: "r-pre", type: "PRE_SESSION_ROUTINE", label: null, mandatory: true, effectiveFrom: MON, retiredFrom: null },
    ],
    pauses: [],
    ...o,
  };
}

function facts(o: { today: string; ready?: string[]; closed?: string[]; trades?: GoalTradeFact[]; journal?: string[]; checkIns?: string[] }): GoalActivityFacts {
  const routine = new Map<string, { preSession: boolean; postSession: boolean }>();
  for (const k of o.ready ?? []) routine.set(k, { preSession: true, postSession: false });
  for (const k of o.closed ?? []) routine.set(k, { preSession: routine.get(k)?.preSession ?? false, postSession: true });
  return {
    todayKey: o.today,
    routine,
    trades: o.trades ?? [],
    journalDates: new Set(o.journal ?? []),
    checkIns: new Set(o.checkIns ?? []),
  };
}

/** The first `n` trading days (Mon–Fri) from `from`. */
function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let k = from; out.length < n; k = addDaysToDateKey(k, 1)) if (weekdays(k) === "REQUIRED") out.push(k);
  return out;
}

const trade = (o: Partial<GoalTradeFact> & { date: string }): GoalTradeFact => ({
  tradeId: Math.random().toString(36).slice(2),
  tradeDateKey: o.date,
  closedDateKey: o.closedDateKey === undefined ? o.date : o.closedDateKey,
  creditDateKey: o.creditDateKey === undefined ? o.date : o.creditDateKey,
  reviewComplete: o.reviewComplete ?? true,
  objective: o.objective ?? [],
  judged: o.judged ?? [],
});

describe("consecutive progress vs historical totals", () => {
  it("12 qualifying days, a miss, then 5 more → 17 successful, current 5, longest 12, progress 5/30", () => {
    const days = tradingDays(MON, 18);
    const ready = [...days.slice(0, 12), ...days.slice(13)]; // day 13 missed
    const today = addDaysToDateKey(days[17], 1); // the day after the 18th trading day
    const p = computeGoalProgress(goal(), [], facts({ today, ready }), ctx());
    expect(p.successfulDays).toBe(17);
    expect(p.currentStreak).toBe(5);
    expect(p.longestStreak).toBe(12);
    expect(p.missedDays).toBe(1);
    expect(p.attempt).toBe(2);
    expect(p.attemptStartedOn).toBe(days[13]);
    expect(progressPercent(30, p.currentStreak)).toBe(17); // 5/30, never 17/30
    expect(remainingDays(30, p.currentStreak)).toBe(25);
  });

  it("weekends and unscheduled days are rest days: they neither count nor break", () => {
    const days = tradingDays(MON, 10); // two full weeks, the weekend between
    const p = computeGoalProgress(goal(), [], facts({ today: addDaysToDateKey(days[9], 1), ready: days }), ctx());
    expect(p.currentStreak).toBe(10);
    // the weekend between the two weeks, plus today (Saturday the 14th)
    expect(p.days.filter((d) => d.status === "REST").map((d) => d.dateKey)).toEqual(["2026-03-07", "2026-03-08", "2026-03-14"]);
  });

  it("a trader who trades every day gets every calendar day evaluated", () => {
    const all = dateKeysBetween(MON, "2026-03-08");
    const ready = all.filter((k) => k !== "2026-03-07"); // skipped Saturday
    const p = computeGoalProgress(goal(), [], facts({ today: "2026-03-09", ready }), ctx(everyDay));
    expect(p.currentStreak).toBe(1);
    expect(p.longestStreak).toBe(5);
    expect(p.days.find((d) => d.dateKey === "2026-03-07")?.status).toBe("MISSED");
  });

  it("a date skipped by a timezone change is a rest day", () => {
    const p = computeGoalProgress(
      goal(),
      [],
      facts({ today: "2026-03-05", ready: ["2026-03-02", "2026-03-04"] }),
      ctx(weekdays, ["2026-03-03"]),
    );
    expect(p.days.find((d) => d.dateKey === "2026-03-03")?.status).toBe("REST");
    expect(p.currentStreak).toBe(2);
  });

  it("a new attempt starts only with a qualifying day", () => {
    const p = computeGoalProgress(goal(), [], facts({ today: "2026-03-05", ready: [MON] }), ctx());
    // Mon qualified, Tue + Wed missed, Thu (today) pending
    expect(p.currentStreak).toBe(0);
    expect(p.attempt).toBe(1);
    expect(p.attemptStartedOn).toBeNull();
    expect(p.today?.status).toBe("PENDING");
  });

  it("nothing before the start date is evaluated", () => {
    const p = computeGoalProgress(goal({ startDate: "2026-03-04" }), [], facts({ today: "2026-03-05", ready: [MON, "2026-03-04"] }), ctx());
    expect(p.days.map((d) => d.dateKey)).toEqual(["2026-03-04", "2026-03-05"]);
    expect(p.currentStreak).toBe(1);
  });
});

describe("finalization", () => {
  it("only past, decided days are finalized, in a contiguous run", () => {
    const g = goal({
      requirements: [{ id: "r-close", type: "CLOSE_AND_REFLECT", label: null, mandatory: true, effectiveFrom: MON, retiredFrom: null }],
    });
    // Mon closed, Tue not closed yet (grace runs through Wed), today = Wed
    const p = computeGoalProgress(g, [], facts({ today: "2026-03-04", closed: [MON] }), ctx());
    expect(p.toFinalize.map((d) => d.dateKey)).toEqual([MON]);
    expect(p.days.find((d) => d.dateKey === "2026-03-03")?.status).toBe("PENDING");
  });

  it("stored days are taken as they are, even if the records changed since", () => {
    const stored: GoalDayRecord[] = [{ dateKey: MON, status: "QUALIFIED", attempt: 1, streakAfter: 1, results: [] }];
    // Monday's readiness is gone from the facts now; the stored day still counts.
    const p = computeGoalProgress(goal(), stored, facts({ today: "2026-03-04", ready: ["2026-03-03"] }), ctx());
    expect(p.currentStreak).toBe(2);
    expect(p.toFinalize.map((d) => d.dateKey)).toEqual(["2026-03-03"]);
    expect(p.toFinalize[0]).toMatchObject({ attempt: 1, streakAfter: 2 });
  });

  it("the longest streak never decreases after a miss", () => {
    const days = tradingDays(MON, 8);
    const first = computeGoalProgress(goal(), [], facts({ today: addDaysToDateKey(days[4], 1), ready: days.slice(0, 5) }), ctx());
    expect(first.longestStreak).toBe(5);
    const stored = first.toFinalize;
    const later = computeGoalProgress(goal(), stored, facts({ today: addDaysToDateKey(days[7], 1), ready: [days[6], days[7]] }), ctx());
    expect(later.currentStreak).toBe(2);
    expect(later.longestStreak).toBe(5);
    expect(later.successfulDays).toBe(7);
  });

  it("completes on the final day that reaches the target, and evaluates nothing after it", () => {
    const days = tradingDays(MON, 9);
    const p = computeGoalProgress(goal({ targetDays: 7 }), [], facts({ today: addDaysToDateKey(days[8], 1), ready: days }), ctx());
    expect(p.completedOn).toBe(days[6]);
    expect(p.days[p.days.length - 1].dateKey).toBe(days[6]);
    expect(p.today).toBeNull();
  });

  it("today qualifying never completes the goal before it is final", () => {
    const days = tradingDays(MON, 7);
    const p = computeGoalProgress(goal({ targetDays: 7 }), [], facts({ today: days[6], ready: days }), ctx());
    expect(p.currentStreak).toBe(7);
    expect(p.completedOn).toBeNull();
  });
});

describe("pauses", () => {
  it("paused days freeze the streak, and resuming continues the same attempt", () => {
    const g = goal({ pauses: [{ fromDate: "2026-03-04", toDate: "2026-03-06" }] });
    const p = computeGoalProgress(g, [], facts({ today: "2026-03-09", ready: [MON, "2026-03-03", "2026-03-06"] }), ctx());
    expect(p.days.filter((d) => d.status === "PAUSED").map((d) => d.dateKey)).toEqual(["2026-03-04", "2026-03-05"]);
    expect(p.currentStreak).toBe(3);
    expect(p.attempt).toBe(1);
  });

  it("an open pause covers today", () => {
    const g = goal({ pauses: [{ fromDate: "2026-03-04", toDate: null }] });
    const p = computeGoalProgress(g, [], facts({ today: "2026-03-05", ready: [MON] }), ctx());
    expect(p.today?.status).toBe("PAUSED");
  });
});

describe("requirement versions", () => {
  it("an edit applies from its effective date; earlier days keep the old rules", () => {
    const g = goal({
      requirements: [
        { id: "r-pre", type: "PRE_SESSION_ROUTINE", label: null, mandatory: true, effectiveFrom: MON, retiredFrom: "2026-03-04" },
        { id: "r-j", type: "JOURNAL_ENTRY", label: null, mandatory: true, effectiveFrom: "2026-03-04", retiredFrom: null },
      ],
    });
    const p = computeGoalProgress(g, [], facts({ today: "2026-03-06", ready: [MON, "2026-03-03"], journal: ["2026-03-04", "2026-03-05"] }), ctx());
    expect(p.currentStreak).toBe(4);
  });

  it("an optional requirement never decides the day", () => {
    const g = goal({
      requirements: [
        { id: "r-pre", type: "PRE_SESSION_ROUTINE", label: null, mandatory: true, effectiveFrom: MON, retiredFrom: null },
        { id: "r-j", type: "JOURNAL_ENTRY", label: null, mandatory: false, effectiveFrom: MON, retiredFrom: null },
      ],
    });
    const p = computeGoalProgress(g, [], facts({ today: "2026-03-05", ready: [MON, "2026-03-03"] }), ctx());
    expect(p.days.find((d) => d.dateKey === MON)?.status).toBe("QUALIFIED");
  });
});

describe("requirement evaluators", () => {
  const D = "2026-03-03";
  const ev = (type: Parameters<typeof evaluateRequirement>[0]["type"], f: GoalActivityFacts, id = "r") =>
    evaluateRequirement({ id, type }, D, f).result;

  it("pre-session routine must be confirmed on the day itself", () => {
    expect(ev("PRE_SESSION_ROUTINE", facts({ today: D }))).toBe("PENDING");
    expect(ev("PRE_SESSION_ROUTINE", facts({ today: "2026-03-04" }))).toBe("NOT_MET");
    expect(ev("PRE_SESSION_ROUTINE", facts({ today: "2026-03-04", ready: [D] }))).toBe("MET");
  });

  it("close & reflect, journal and check-ins have one day of grace", () => {
    expect(ev("CLOSE_AND_REFLECT", facts({ today: "2026-03-04" }))).toBe("PENDING");
    expect(ev("CLOSE_AND_REFLECT", facts({ today: "2026-03-05" }))).toBe("NOT_MET");
    expect(ev("JOURNAL_ENTRY", facts({ today: "2026-03-04" }))).toBe("PENDING");
    expect(ev("JOURNAL_ENTRY", facts({ today: "2026-03-05", journal: [D] }))).toBe("MET");
    expect(ev("CUSTOM_CHECKIN", facts({ today: "2026-03-05", checkIns: [`r|${D}`] }))).toBe("MET");
    expect(ev("CUSTOM_CHECKIN", facts({ today: "2026-03-05", checkIns: [`other|${D}`] }))).toBe("NOT_MET");
  });

  it("reviews: a trade closed late and reviewed next morning still counts", () => {
    const t = trade({ date: D, creditDateKey: "2026-03-04" });
    expect(ev("REVIEW_CLOSED_TRADES", facts({ today: "2026-03-09", trades: [t] }))).toBe("MET");
    const late = trade({ date: D, creditDateKey: "2026-03-05" });
    expect(ev("REVIEW_CLOSED_TRADES", facts({ today: "2026-03-09", trades: [late] }))).toBe("NOT_MET");
    const open = trade({ date: D, creditDateKey: null, reviewComplete: false });
    expect(ev("REVIEW_CLOSED_TRADES", facts({ today: "2026-03-04", trades: [open] }))).toBe("PENDING");
    expect(ev("REVIEW_CLOSED_TRADES", facts({ today: "2026-03-09" }))).toBe("NOT_APPLICABLE");
  });

  it("follow my plan: one violation spoils the day, however many trades were clean", () => {
    const clean = trade({ date: D });
    const revenge = trade({ date: D, objective: [{ key: "impulsiveIntent", label: "Revenge trade" }] });
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-09", trades: [clean, clean, revenge] }))).toBe("NOT_MET");
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-09", trades: [clean] }))).toBe("MET");
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-09" }))).toBe("NOT_APPLICABLE");
  });

  it("an unreviewed trade cannot hide a violation, and expires after the grace period", () => {
    const bad = trade({ date: D, objective: [{ key: "setupOverridden", label: "Setup validation was overridden" }] });
    const unreviewed = trade({ date: D, reviewComplete: false, creditDateKey: null });
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-04", trades: [bad, unreviewed] }))).toBe("NOT_MET");
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-04", trades: [unreviewed] }))).toBe("PENDING");
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-05", trades: [unreviewed] }))).toBe("NOT_MET");
  });

  it("plan and risk are judged separately", () => {
    const widened = trade({ date: D, objective: [{ key: "stopWidened", label: "Stop moved wider than planned" }] });
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-09", trades: [widened] }))).toBe("MET");
    expect(ev("RESPECT_RISK", facts({ today: "2026-03-09", trades: [widened] }))).toBe("NOT_MET");
    const fomo = trade({ date: D, objective: [{ key: "impulsiveIntent", label: "Entered out of FOMO" }] });
    expect(ev("RESPECT_RISK", facts({ today: "2026-03-09", trades: [fomo] }))).toBe("MET");
  });

  it("profit plays no part: a losing trade that followed every rule meets the plan", () => {
    // GoalTradeFact carries no PnL at all; a loss is indistinguishable from a win here by design.
    const loss = trade({ date: D });
    expect(ev("FOLLOW_PLAN", facts({ today: "2026-03-09", trades: [loss] }))).toBe("MET");
  });
});

describe("requirement sets", () => {
  const every = (t: Parameters<typeof requirementCatalogueEntry>[0]) => requirementCatalogueEntry(t).everyTradingDay;

  it("requires at least one mandatory every-trading-day item", () => {
    expect(requirementSetProblem([{ type: "FOLLOW_PLAN", label: null, mandatory: true }], every)).toMatch(/every trading day/);
    expect(requirementSetProblem([{ type: "JOURNAL_ENTRY", label: null, mandatory: false }, { type: "FOLLOW_PLAN", label: null, mandatory: true }], every)).toMatch(/every trading day/);
    expect(requirementSetProblem([{ type: "JOURNAL_ENTRY", label: null, mandatory: true }, { type: "FOLLOW_PLAN", label: null, mandatory: true }], every)).toBeNull();
  });

  it("rejects duplicates, unnamed check-ins and empty sets", () => {
    expect(requirementSetProblem([], every)).toMatch(/at least one/);
    expect(requirementSetProblem([{ type: "JOURNAL_ENTRY", label: null, mandatory: true }, { type: "JOURNAL_ENTRY", label: null, mandatory: true }], every)).toMatch(/once/);
    expect(requirementSetProblem([{ type: "CUSTOM_CHECKIN", label: "  ", mandatory: true }], every)).toMatch(/name/);
    expect(requirementSetProblem([{ type: "CUSTOM_CHECKIN", label: "Gym", mandatory: true }, { type: "CUSTOM_CHECKIN", label: "gym", mandatory: true }], every)).toMatch(/different/);
  });
});

describe("helpers", () => {
  it("projects the completion date over trading days only", () => {
    const isTrading = (k: string) => weekdays(k) === "REQUIRED";
    // Monday, 5 days left, today not yet qualified → Friday
    expect(projectedCompletionDate(5, MON, false, isTrading)).toBe("2026-03-06");
    // already qualified today → the next five trading days end next Monday
    expect(projectedCompletionDate(5, MON, true, isTrading)).toBe("2026-03-09");
    expect(projectedCompletionDate(0, MON, true, isTrading)).toBe(MON);
    expect(projectedCompletionDate(3, MON, false, () => false)).toBeNull();
  });

  it("detects real journal content in Tiptap documents", () => {
    expect(richTextHasContent(null)).toBe(false);
    expect(richTextHasContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(richTextHasContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] })).toBe(false);
    expect(richTextHasContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Waited for London." }] }] })).toBe(true);
  });
});
