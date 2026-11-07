/**
 * Goals — the daily requirement catalogue and its evaluators (pure).
 *
 * A requirement reads activity Traditorium already records (routine, day
 * close, reviews, trades, daily notes). Only CUSTOM_CHECKIN is ticked by
 * hand, for commitments outside the app. Profit, R and win rate are never
 * inputs: a losing trade that followed every rule meets FOLLOW_PLAN.
 *
 * Each evaluator answers, for one trader-local date:
 *   MET             the requirement is satisfied
 *   NOT_MET         it can no longer be satisfied for that date
 *   NOT_APPLICABLE  nothing was owed (e.g. no trade closed → nothing to review)
 *   PENDING         still open: the date is today, or inside its grace period
 *
 * Grace: anything that is naturally done after the session (closing the day,
 * reviewing a trade, journaling, a check-in) may land up to the end of the
 * NEXT local date. After that an open item is NOT_MET.
 */
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import { RISK_VIOLATION_KEYS, type AdherenceViolation } from "@/domain/discipline/streaks/plan-adherence";

export type GoalRequirementType =
  | "PRE_SESSION_ROUTINE"
  | "CLOSE_AND_REFLECT"
  | "REVIEW_CLOSED_TRADES"
  | "FOLLOW_PLAN"
  | "RESPECT_RISK"
  | "JOURNAL_ENTRY"
  | "CUSTOM_CHECKIN";

export type RequirementResult = "MET" | "NOT_MET" | "NOT_APPLICABLE" | "PENDING";

/** Local dates after a day during which post-session work still counts for it. */
export const GOAL_GRACE_DAYS = 1;

export interface RequirementCatalogueEntry {
  type: GoalRequirementType;
  title: string;
  description: string;
  /**
   * True when the requirement is owed on EVERY scheduled trading day. Every
   * goal needs at least one mandatory such requirement, so a quiet no-trade
   * day can never qualify without the trader doing anything.
   */
  everyTradingDay: boolean;
}

/** Order = display order. */
export const GOAL_REQUIREMENTS: readonly RequirementCatalogueEntry[] = [
  {
    type: "PRE_SESSION_ROUTINE",
    title: "Complete my pre-session routine",
    description: "Confirm “I am ready to trade” in Today on the day itself.",
    everyTradingDay: true,
  },
  {
    type: "CLOSE_AND_REFLECT",
    title: "Close the day with a reflection",
    description: "Close the trading day with a written reflection, by the end of the next day.",
    everyTradingDay: true,
  },
  {
    type: "REVIEW_CLOSED_TRADES",
    title: "Review every closed trade",
    description: "Complete the final review of each trade that closes, by the end of the next day.",
    everyTradingDay: false,
  },
  {
    type: "FOLLOW_PLAN",
    title: "Follow my trading plan",
    description:
      "Every trade taken is planned, has a valid setup, follows your bias and gets a “yes” to every process question in its review.",
    everyTradingDay: false,
  },
  {
    type: "RESPECT_RISK",
    title: "Respect my risk rules",
    description: "No trade exceeds today's limits or widens its stop, and risk and the exit plan were managed as planned.",
    everyTradingDay: false,
  },
  {
    type: "JOURNAL_ENTRY",
    title: "Write a journal entry",
    description: "Write the day's journal note, by the end of the next day.",
    everyTradingDay: true,
  },
  {
    type: "CUSTOM_CHECKIN",
    title: "Custom daily check-in",
    description: "Something outside Traditorium you commit to, ticked off each day.",
    everyTradingDay: true,
  },
];

export function requirementCatalogueEntry(type: GoalRequirementType): RequirementCatalogueEntry {
  const e = GOAL_REQUIREMENTS.find((r) => r.type === type);
  if (!e) throw new RangeError(`Unknown goal requirement type: ${type}`);
  return e;
}

/** What the discipline rules know about one executed LIVE trade. */
export interface GoalTradeFact {
  tradeId: string;
  tradeDateKey: string;
  closedDateKey: string | null;
  creditDateKey: string | null;
  reviewComplete: boolean;
  objective: readonly AdherenceViolation[];
  judged: readonly AdherenceViolation[];
}

/** Activity facts for every date the evaluation can touch. */
export interface GoalActivityFacts {
  todayKey: string;
  /** Pre-session / post-session halves of the routine, by local date. */
  routine: ReadonlyMap<string, { preSession: boolean; postSession: boolean }>;
  trades: readonly GoalTradeFact[];
  /** Local dates with a daily journal note that has real content. */
  journalDates: ReadonlySet<string>;
  /** `${requirementId}|${dateKey}` for every custom check-in. */
  checkIns: ReadonlySet<string>;
}

export interface RequirementEvaluation {
  result: RequirementResult;
  /** Plain-language reasons for NOT_MET / PENDING (shown in the day history). */
  reasons: string[];
}

const met = (): RequirementEvaluation => ({ result: "MET", reasons: [] });
const na = (): RequirementEvaluation => ({ result: "NOT_APPLICABLE", reasons: [] });
const notMet = (...reasons: string[]): RequirementEvaluation => ({ result: "NOT_MET", reasons });
const pending = (...reasons: string[]): RequirementEvaluation => ({ result: "PENDING", reasons });

/** True while `dateKey` is today or inside its grace period. */
export function withinGrace(dateKey: string, todayKey: string): boolean {
  return todayKey <= addDaysToDateKey(dateKey, GOAL_GRACE_DAYS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function evaluateTradeRule(
  trades: readonly GoalTradeFact[],
  dateKey: string,
  todayKey: string,
  inScope: (v: AdherenceViolation) => boolean,
): RequirementEvaluation {
  if (trades.length === 0) return na();
  const broken: string[] = [];
  let awaiting = 0;
  for (const t of trades) {
    const violations = [...t.objective, ...t.judged].filter(inScope);
    if (violations.length > 0) broken.push(...violations.map((v) => v.label));
    else if (!t.reviewComplete) awaiting += 1;
  }
  if (broken.length > 0) return notMet(...new Set(broken));
  if (awaiting > 0) {
    const why = `${plural(awaiting, "trade")} awaiting final review`;
    return withinGrace(dateKey, todayKey) ? pending(why) : notMet(`${why} after the grace period`);
  }
  return met();
}

export function evaluateRequirement(
  r: { id: string; type: GoalRequirementType },
  dateKey: string,
  f: GoalActivityFacts,
): RequirementEvaluation {
  const open = withinGrace(dateKey, f.todayKey);
  switch (r.type) {
    case "PRE_SESSION_ROUTINE": {
      if (f.routine.get(dateKey)?.preSession) return met();
      return dateKey === f.todayKey ? pending("Pre-session routine not confirmed yet") : notMet("Pre-session routine not confirmed");
    }
    case "CLOSE_AND_REFLECT": {
      if (f.routine.get(dateKey)?.postSession) return met();
      return open ? pending("Day not closed with a reflection yet") : notMet("Day not closed with a reflection");
    }
    case "REVIEW_CLOSED_TRADES": {
      const closed = f.trades.filter((t) => t.closedDateKey === dateKey);
      if (closed.length === 0) return na();
      const deadline = addDaysToDateKey(dateKey, GOAL_GRACE_DAYS);
      const late = closed.filter((t) => t.creditDateKey == null || t.creditDateKey > deadline).length;
      if (late === 0) return met();
      const why = `${plural(late, "closed trade")} without a final review`;
      return open ? pending(why) : notMet(why);
    }
    case "FOLLOW_PLAN":
      return evaluateTradeRule(
        f.trades.filter((t) => t.tradeDateKey === dateKey),
        dateKey,
        f.todayKey,
        (v) => !RISK_VIOLATION_KEYS.has(v.key),
      );
    case "RESPECT_RISK":
      return evaluateTradeRule(
        f.trades.filter((t) => t.tradeDateKey === dateKey),
        dateKey,
        f.todayKey,
        (v) => RISK_VIOLATION_KEYS.has(v.key),
      );
    case "JOURNAL_ENTRY": {
      if (f.journalDates.has(dateKey)) return met();
      return open ? pending("No journal entry yet") : notMet("No journal entry");
    }
    case "CUSTOM_CHECKIN": {
      if (f.checkIns.has(`${r.id}|${dateKey}`)) return met();
      return open ? pending("Not checked in yet") : notMet("Not checked in");
    }
  }
}
