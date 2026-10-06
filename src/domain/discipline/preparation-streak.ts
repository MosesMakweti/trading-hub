/**
 * Preparation outcomes across dates, corrections, and the Preparation Streak
 * (Phase 1, pure).
 *
 * `evaluatePreparationDays` is the deterministic finalization function
 * Phase 2 persists: for every local date from the scoring-era start through
 * the trader's today it yields exactly one outcome — including scheduled
 * dates with no TradingDay row at all (no facts → MISSED after the cutoff).
 *
 * The streak is DERIVED from those outcomes (+ the latest correction per
 * date), never stored as a counter:
 *   counts   VERY_EARLY · EARLY · ON_TIME · LATE · VERY_LATE
 *   breaks   INCOMPLETE · MISSED
 *   exempt   DAY_OFF · NOT_SCHEDULED
 *   pending  today before its cutoff (and not yet ready) → neither
 */
import { addDaysToDateKey } from "@/domain/time/trader-calendar";
import { STREAK_BREAKING, STREAK_COUNTED, type PreparationStatus } from "./preparation-config";
import {
  dayApplicability,
  scoringEraStart,
  type PreparationDayException,
  type PreparationScheduleVersion,
} from "./preparation-schedule";
import { scorePreparationDay, type PendingPreparation, type PreparationDayFacts, type PreparationScoreBreakdown } from "./preparation-score";

export type DayOutcome =
  | { dateKey: string; kind: "SCORED"; scheduleVersionId: string; timezone: string; breakdown: PreparationScoreBreakdown }
  | { dateKey: string; kind: "PENDING"; scheduleVersionId: string; timezone: string; pending: PendingPreparation }
  | { dateKey: string; kind: "EXEMPT"; scheduleVersionId: string; timezone: string; status: "DAY_OFF" | "NOT_SCHEDULED" };

const EMPTY_FACTS: PreparationDayFacts = { firstReadyAt: null, requiredItems: [] };

/**
 * One outcome per date in [max(eraStart, fromDateKey), todayKey]. `facts`
 * maps dateKey → that day's frozen facts (absent = no TradingDay row).
 */
export function evaluatePreparationDays(input: {
  versions: readonly PreparationScheduleVersion[];
  exceptions: readonly PreparationDayException[];
  facts: ReadonlyMap<string, PreparationDayFacts>;
  todayKey: string;
  now: Date;
  /** Optional lower bound (e.g. the day after the last persisted record). */
  fromDateKey?: string;
}): DayOutcome[] {
  const era = scoringEraStart(input.versions);
  if (!era) return [];
  let date = input.fromDateKey && input.fromDateKey > era ? input.fromDateKey : era;
  const out: DayOutcome[] = [];
  while (date <= input.todayKey) {
    const a = dayApplicability(input.versions, input.exceptions, date);
    if (a.kind === "NOT_SCHEDULED") {
      out.push({ dateKey: date, kind: "EXEMPT", scheduleVersionId: a.version.id, timezone: a.version.timezone, status: "NOT_SCHEDULED" });
    } else if (a.kind === "DAY_OFF") {
      out.push({ dateKey: date, kind: "EXEMPT", scheduleVersionId: a.version.id, timezone: a.version.timezone, status: "DAY_OFF" });
    } else if (a.kind === "SCHEDULED") {
      const r = scorePreparationDay(a.version.rules, a.instants, input.facts.get(date) ?? EMPTY_FACTS, input.now);
      if (r.status === "PENDING") {
        out.push({ dateKey: date, kind: "PENDING", scheduleVersionId: a.version.id, timezone: a.version.timezone, pending: r });
      } else {
        out.push({ dateKey: date, kind: "SCORED", scheduleVersionId: a.version.id, timezone: a.version.timezone, breakdown: r });
      }
    }
    date = addDaysToDateKey(date, 1);
  }
  return out;
}

// ── Corrections ─────────────────────────────────────────────────────────────

/** An audited administrative correction (append-only); the latest per date wins. */
export interface PreparationCorrection {
  dateKey: string;
  status: PreparationStatus;
  score: number;
  reason: string;
  actor: string;
  createdAt: Date;
}

/** The effective status/score of a date: the latest correction, else the original. */
export interface EffectiveDay {
  dateKey: string;
  status: PreparationStatus | "PENDING";
  score: number | null;
  corrected: boolean;
}

export function effectiveDays(outcomes: readonly DayOutcome[], corrections: readonly PreparationCorrection[]): EffectiveDay[] {
  const latest = new Map<string, PreparationCorrection>();
  for (const c of corrections) {
    if (!c.reason.trim() || !c.actor.trim()) continue; // invalid corrections are ignored
    const prev = latest.get(c.dateKey);
    if (!prev || c.createdAt.getTime() > prev.createdAt.getTime()) latest.set(c.dateKey, c);
  }
  return outcomes.map((o) => {
    const c = latest.get(o.dateKey);
    if (c && o.kind !== "PENDING") return { dateKey: o.dateKey, status: c.status, score: c.score, corrected: true };
    if (o.kind === "SCORED") return { dateKey: o.dateKey, status: o.breakdown.status, score: o.breakdown.score, corrected: false };
    if (o.kind === "PENDING") return { dateKey: o.dateKey, status: "PENDING", score: null, corrected: false };
    return { dateKey: o.dateKey, status: o.status, score: null, corrected: false };
  });
}

// ── Streak ──────────────────────────────────────────────────────────────────

export interface StreakBreak {
  /** The date whose INCOMPLETE/MISSED outcome ended the streak. */
  dateKey: string;
  status: "INCOMPLETE" | "MISSED";
  /** The streak length that ended (≥ 1; a break of an empty streak is not reported). */
  endedLength: number;
}

export interface PreparationStreak {
  current: number;
  longest: number;
  /** The most recent break (if any) — the streak-break notice. */
  lastBreak: StreakBreak | null;
  /** True when the current streak started after a break ("New streak started"). */
  restartedAfterBreak: boolean;
}

/** Walks dates in ascending order. */
export function derivePreparationStreak(days: readonly EffectiveDay[]): PreparationStreak {
  const ordered = [...days].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  let current = 0;
  let longest = 0;
  let lastBreak: StreakBreak | null = null;
  let brokenSinceLastCount = false;
  for (const d of ordered) {
    if (d.status === "PENDING") continue;
    if (STREAK_COUNTED.has(d.status)) {
      current += 1;
      longest = Math.max(longest, current);
      brokenSinceLastCount = false;
    } else if (STREAK_BREAKING.has(d.status)) {
      if (current > 0) lastBreak = { dateKey: d.dateKey, status: d.status as "INCOMPLETE" | "MISSED", endedLength: current };
      current = 0;
      brokenSinceLastCount = true;
    }
    // exempt statuses: no change
  }
  return { current, longest, lastBreak, restartedAfterBreak: lastBreak != null && current > 0 && !brokenSinceLastCount };
}
