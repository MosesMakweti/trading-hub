import { Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { isBacktestScope } from "@/server/workspace/scope";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import {
  PREPARATION_SCORING_V1,
  dayApplicability,
  derivePreparationStreak,
  effectiveDays,
  evaluatePreparationDays,
  nextEffectiveDate,
  scheduleVersionFor,
  scorePreparationDay,
  validateScheduleVersion,
  type DayOutcome,
  type EffectiveDay,
  type PendingPreparation,
  type PreparationCorrection,
  type PreparationDayException,
  type PreparationDayFacts,
  type PreparationScheduleVersion,
  type PreparationScoreBreakdown,
  type PreparationScoringRules,
  type PreparationStatus,
  type PreparationStreak,
  type StreakBreak,
} from "@/domain/discipline";
import {
  addDaysToDateKey,
  effectiveTimezoneAt,
  isValidTimeZone,
  pendingTimezoneAt,
  traderTodayKey,
  type TimezoneVersion,
} from "@/domain/time/trader-calendar";
import type { RoutineSnapshot } from "@/domain/today/routine-snapshot";

/**
 * Preparation Score — persistence (Phase 2). LIVE only.
 *
 *   existing routine → write-once first readiness → per-item first completion
 *   → frozen daily requirements → frozen schedule version → deterministic
 *   outcome (domain/discipline) → immutable PreparationDayRecord → derived streak
 *
 * The routine (today-routine.service.ts) stays canonical — this service only
 * OBSERVES it. Nothing here gates Today. No schedule confirmed → nothing is
 * scored, no records, no misses, no streak.
 */

type Db = TransactionClient | typeof prisma;

export class PreparationError extends Error {}

const lock = (tx: TransactionClient, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

// ── Schedule versions ───────────────────────────────────────────────────────

function toDomainVersion(row: {
  id: string;
  effectiveFrom: Date;
  timezone: string;
  targetMinutes: number;
  weekdays: number[];
  rules: Prisma.JsonValue;
  createdAt: Date;
}): PreparationScheduleVersion {
  return {
    id: row.id,
    effectiveFrom: utcDateToKey(row.effectiveFrom),
    timezone: row.timezone,
    targetMinutes: row.targetMinutes,
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    rules: row.rules as unknown as PreparationScoringRules,
    createdAt: row.createdAt,
  };
}

export async function getScheduleVersions(userId: string, db: Db = prisma): Promise<PreparationScheduleVersion[]> {
  const rows = await db.preparationScheduleVersion.findMany({ where: { userId }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  return rows.map(toDomainVersion);
}

export interface ConfirmScheduleInput {
  targetMinutes: number;
  weekdays: number[];
}

const timezoneVersions = (db: Db, userId: string): Promise<TimezoneVersion[]> =>
  db.traderTimezoneVersion.findMany({ where: { userId }, select: { timezone: true, effectiveFrom: true, createdAt: true } });

/**
 * The trader timezone that governs the trader's NEXT local date. A confirmed
 * timezone change always takes effect at the start of that date
 * (trader-calendar `effectiveFromForChange`), so a pending change — if any —
 * is exactly the zone of the next date; otherwise the current zone continues.
 */
function timezoneForNextLocalDate(tzVersions: readonly TimezoneVersion[], now: Date): string {
  return pendingTimezoneAt(tzVersions, now)?.timezone ?? effectiveTimezoneAt(tzVersions, now);
}

/**
 * createdAt for a new version: `now`, but strictly after every existing
 * version, so "latest createdAt wins" on a shared effectiveFrom always means
 * "the last write under the lock wins", even if callers' clocks interleave.
 */
function monotonicCreatedAt(existing: readonly PreparationScheduleVersion[], now: Date): Date {
  const latest = existing.reduce((m, v) => Math.max(m, v.createdAt.getTime()), 0);
  return new Date(Math.max(now.getTime(), latest + 1));
}

/**
 * Confirms the Preparation Schedule. Always appends a NEW immutable version
 * effective from the trader's NEXT local date — today's (and every past)
 * outcome is never rewritten. Re-confirming the schedule already in place
 * for that date is a no-op (double submits never duplicate versions).
 *
 * Timezone (Phase 3): the schedule has no timezone of its own — it always
 * uses the canonical trader timezone that governs the effective date
 * (including a change confirmed today that starts tomorrow). Changing the
 * timezone goes through trader-time.service, which appends the matching
 * schedule version (`syncScheduleTimezone`), so the two never drift apart.
 * Lock order (both writers): trader-timezone → prep-schedule.
 */
export async function confirmPreparationSchedule(userId: string, input: ConfirmScheduleInput, now: Date = new Date()) {
  if (isBacktestScope()) throw new PreparationError("The Preparation Schedule is set from the live workspace.");
  return prisma.$transaction(async (tx) => {
    await lock(tx, `trader-timezone:${userId}`);
    await lock(tx, `prep-schedule:${userId}`);
    const tzVersions = await timezoneVersions(tx, userId);
    const timezone = timezoneForNextLocalDate(tzVersions, now);
    if (!isValidTimeZone(timezone)) throw new PreparationError("Choose a valid timezone.");
    const effectiveFrom = nextEffectiveDate(traderTodayKey(tzVersions, now));
    const candidate = {
      effectiveFrom,
      timezone,
      targetMinutes: input.targetMinutes,
      weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
      rules: PREPARATION_SCORING_V1,
    };
    const errors = validateScheduleVersion(candidate);
    if (errors.length > 0) throw new PreparationError(errors.join(" "));

    const existing = (await tx.preparationScheduleVersion.findMany({ where: { userId } })).map(toDomainVersion);
    const inPlace = scheduleVersionFor(existing, effectiveFrom);
    if (
      inPlace &&
      inPlace.timezone === candidate.timezone &&
      inPlace.targetMinutes === candidate.targetMinutes &&
      inPlace.weekdays.join(",") === candidate.weekdays.join(",") &&
      inPlace.rules.scoringVersion === candidate.rules.scoringVersion
    ) {
      return { created: false, version: inPlace };
    }
    const row = await tx.preparationScheduleVersion.create({
      data: {
        userId,
        effectiveFrom: dateKeyToUtcDate(effectiveFrom),
        timezone,
        targetMinutes: candidate.targetMinutes,
        weekdays: candidate.weekdays,
        rules: candidate.rules as unknown as Prisma.InputJsonValue,
        scoringVersion: candidate.rules.scoringVersion,
        createdAt: monotonicCreatedAt(existing, now),
      },
    });
    return { created: true, version: toDomainVersion(row) };
  });
}

/**
 * Timezone synchronization (Phase 3). Called by trader-time.service inside
 * the transaction that records a trader timezone change, AFTER the new
 * TraderTimezoneVersion is written (the caller already holds the
 * trader-timezone lock). If a Preparation Schedule exists and the version
 * governing the trader's next local date uses a different zone, a NEW
 * version is appended for that same date — same target, weekdays and frozen
 * rules, the new zone. Existing versions and records are never touched.
 * Returns the created version, or null when nothing needed to change.
 */
export async function syncScheduleTimezone(tx: TransactionClient, userId: string, now: Date): Promise<PreparationScheduleVersion | null> {
  await lock(tx, `prep-schedule:${userId}`);
  const versions = await getScheduleVersions(userId, tx);
  if (versions.length === 0) return null;
  const tzVersions = await timezoneVersions(tx, userId);
  const effectiveFrom = nextEffectiveDate(traderTodayKey(tzVersions, now));
  const timezone = timezoneForNextLocalDate(tzVersions, now);
  const inPlace = scheduleVersionFor(versions, effectiveFrom);
  // No version governs that date yet (impossible: versions start at most tomorrow) or already in sync.
  if (!inPlace || inPlace.timezone === timezone) return null;
  const row = await tx.preparationScheduleVersion.create({
    data: {
      userId,
      effectiveFrom: dateKeyToUtcDate(effectiveFrom),
      timezone,
      targetMinutes: inPlace.targetMinutes,
      weekdays: inPlace.weekdays,
      rules: inPlace.rules as unknown as Prisma.InputJsonValue,
      scoringVersion: inPlace.rules.scoringVersion,
      createdAt: monotonicCreatedAt(versions, now),
    },
  });
  return toDomainVersion(row);
}

// ── Exceptions ──────────────────────────────────────────────────────────────

/**
 * Records a DAY_OFF / EXTRA_DAY for a local date. It counts only when made
 * BEFORE that date's target instant — at the target or later it is refused
 * (a late DAY_OFF can't erase a miss; history uses corrections).
 */
export async function addPreparationException(
  userId: string,
  dateKey: string,
  kind: "DAY_OFF" | "EXTRA_DAY",
  now: Date = new Date(),
  note: string | null = null,
) {
  if (isBacktestScope()) throw new PreparationError("Preparation exceptions are live-only.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new PreparationError("Invalid date.");
  return prisma.$transaction(async (tx) => {
    await lock(tx, `prep-schedule:${userId}`);
    const versions = await getScheduleVersions(userId, tx);
    const version = scheduleVersionFor(versions, dateKey);
    if (!version) throw new PreparationError("That date is before your Preparation Schedule starts.");
    const probe: PreparationDayException = { dateKey, kind, createdAt: now };
    const before = dayApplicability(versions, [], dateKey);
    const after = dayApplicability(versions, [probe], dateKey);
    if (kind === "DAY_OFF" && after.kind !== "DAY_OFF") {
      throw new PreparationError(
        before.kind === "NOT_SCHEDULED" ? "That date isn't a scheduled trading day." : "A day off must be set before that day's target time.",
      );
    }
    if (kind === "EXTRA_DAY" && !(after.kind === "SCHEDULED" && after.viaExtraDay)) {
      throw new PreparationError(
        before.kind === "SCHEDULED" ? "That date is already a scheduled trading day." : "An extra day must be set before that day's target time.",
      );
    }
    const dup = await tx.preparationDayException.findFirst({ where: { userId, date: dateKeyToUtcDate(dateKey), kind } });
    if (dup) return dup;
    return tx.preparationDayException.create({ data: { userId, date: dateKeyToUtcDate(dateKey), kind, note, createdAt: now } });
  });
}

// ── Facts ───────────────────────────────────────────────────────────────────

/** The frozen scoring facts of LIVE TradingDays in [from, to]. Backtest days are never read. */
async function liveDayFacts(db: Db, userId: string, from: string, to: string): Promise<Map<string, PreparationDayFacts>> {
  const days = await db.tradingDay.findMany({
    where: { userId, backtestRunId: null, date: { gte: dateKeyToUtcDate(from), lte: dateKeyToUtcDate(to) } },
    select: { date: true, routineFirstReadyAt: true, routineScoringRequirements: true, routineSnapshot: true },
  });
  const map = new Map<string, PreparationDayFacts>();
  for (const d of days) {
    const ids = Array.isArray(d.routineScoringRequirements) ? (d.routineScoringRequirements as string[]) : [];
    const responses = ((d.routineSnapshot as unknown as RoutineSnapshot | null)?.responses ?? {}) as RoutineSnapshot["responses"];
    map.set(utcDateToKey(d.date), {
      firstReadyAt: d.routineFirstReadyAt,
      requiredItems: ids.map((id) => {
        const at = responses[id]?.firstCompletedAt;
        return { id, completedAt: at ? new Date(at) : null };
      }),
    });
  }
  return map;
}

/**
 * The Preparation "today" is the trader's canonical today (Phase 0
 * calendar). Schedule versions follow the trader timezone (synchronized
 * since Phase 3), so every date before this key is past its cutoff.
 */
async function preparationTodayKey(db: Db, userId: string, now: Date): Promise<string> {
  return traderTodayKey(await timezoneVersions(db, userId), now);
}

// ── Finalization ────────────────────────────────────────────────────────────

/**
 * Lazily turns every final outcome since the last stored record into an
 * immutable PreparationDayRecord (no cron). Per-user advisory lock;
 * idempotent; concurrent calls produce each record once. Handles dates with
 * no TradingDay (→ MISSED after the cutoff). PENDING is never stored;
 * NOT_SCHEDULED dates are deterministic from the frozen versions and are
 * not stored either. Returns the number of records created.
 */
export async function finalizePreparationDays(userId: string, now: Date = new Date()): Promise<number> {
  if (isBacktestScope()) return 0;
  return prisma.$transaction(async (tx) => {
    await lock(tx, `prep-finalize:${userId}`);
    const versions = await getScheduleVersions(userId, tx);
    if (versions.length === 0) return 0; // no schedule → no scoring at all

    const last = await tx.preparationDayRecord.findFirst({ where: { userId }, orderBy: { date: "desc" }, select: { date: true } });
    const todayKey = await preparationTodayKey(tx, userId, now);
    const from = last ? addDaysToDateKey(utcDateToKey(last.date), 1) : undefined;
    const era = versions.reduce((m, v) => (v.effectiveFrom < m ? v.effectiveFrom : m), versions[0].effectiveFrom);
    const start = from && from > era ? from : era;
    if (start > todayKey) return 0;

    const [exceptions, facts] = await Promise.all([
      tx.preparationDayException.findMany({ where: { userId, date: { gte: dateKeyToUtcDate(start) } } }),
      liveDayFacts(tx, userId, start, todayKey),
    ]);
    const outcomes = evaluatePreparationDays({
      versions,
      exceptions: exceptions.map((e) => ({ dateKey: utcDateToKey(e.date), kind: e.kind, createdAt: e.createdAt })),
      facts,
      todayKey,
      now,
      fromDateKey: start,
    });

    const rows: Prisma.PreparationDayRecordCreateManyInput[] = [];
    for (const o of outcomes) {
      if (o.kind === "SCORED") rows.push(recordFromBreakdown(userId, o, now));
      else if (o.kind === "EXEMPT" && o.status === "DAY_OFF") rows.push(dayOffRecord(userId, o, versions, now));
    }
    if (rows.length === 0) return 0;
    const { count } = await tx.preparationDayRecord.createMany({ data: rows, skipDuplicates: true });
    return count;
  });
}

function recordFromBreakdown(userId: string, o: Extract<DayOutcome, { kind: "SCORED" }>, now: Date): Prisma.PreparationDayRecordCreateManyInput {
  const b = o.breakdown;
  return {
    userId,
    date: dateKeyToUtcDate(o.dateKey),
    scheduleVersionId: o.scheduleVersionId,
    timezone: o.timezone,
    targetAt: b.targetAt,
    cutoffAt: b.cutoffAt,
    readyAt: b.readyAt,
    deviationSeconds: b.deviationMs == null ? null : Math.trunc(b.deviationMs / 1000),
    deviationMinutes: b.deviationMinutes,
    requiredTotal: b.requiredTotal,
    requiredDone: b.requiredDone,
    completionPoints: b.completionPoints,
    timingPoints: b.timingPoints,
    score: b.score,
    status: b.status,
    bandLabel: b.bandLabel,
    scoringVersion: b.scoringVersion,
    finalizedAt: now,
  };
}

function dayOffRecord(
  userId: string,
  o: Extract<DayOutcome, { kind: "EXEMPT" }>,
  versions: PreparationScheduleVersion[],
  now: Date,
): Prisma.PreparationDayRecordCreateManyInput {
  const a = dayApplicability(versions, [], o.dateKey);
  const version = scheduleVersionFor(versions, o.dateKey)!;
  const instants = a.kind === "SCHEDULED" || a.kind === "DAY_OFF" ? a.instants : null;
  return {
    userId,
    date: dateKeyToUtcDate(o.dateKey),
    scheduleVersionId: o.scheduleVersionId,
    timezone: o.timezone,
    targetAt: instants?.targetAt ?? now,
    cutoffAt: instants?.cutoffAt ?? now,
    readyAt: null,
    requiredTotal: 0,
    requiredDone: 0,
    completionPoints: 0,
    timingPoints: 0,
    score: 0,
    status: "DAY_OFF",
    scoringVersion: version.rules.scoringVersion,
    finalizedAt: now,
  };
}

// ── Corrections ─────────────────────────────────────────────────────────────

export interface CorrectionInput {
  status: PreparationStatus;
  score: number;
  completionPoints?: number | null;
  timingPoints?: number | null;
  reason: string;
  actor: string;
}

/** Administrative, audited, append-only. The record itself is never changed. No UI in Phase 2. */
export async function addPreparationCorrection(recordId: string, input: CorrectionInput, now: Date = new Date()) {
  if (!input.reason?.trim()) throw new PreparationError("A correction needs a reason.");
  if (!input.actor?.trim()) throw new PreparationError("A correction needs an actor.");
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) throw new PreparationError("Score must be 0–100.");
  const record = await prisma.preparationDayRecord.findUnique({ where: { id: recordId }, select: { id: true, userId: true } });
  if (!record) throw new PreparationError("Preparation record not found.");
  return prisma.preparationDayCorrection.create({
    data: {
      userId: record.userId,
      recordId,
      status: input.status,
      score: input.score,
      completionPoints: input.completionPoints ?? null,
      timingPoints: input.timingPoints ?? null,
      reason: input.reason.trim(),
      actor: input.actor.trim(),
      createdAt: now,
    },
  });
}

// ── Read model ──────────────────────────────────────────────────────────────

export type PreparationToday =
  | { kind: "OUTSIDE_ERA" }
  | { kind: "NOT_SCHEDULED" }
  | { kind: "DAY_OFF" }
  | { kind: "PENDING"; pending: PendingPreparation }
  | { kind: "SCORED"; breakdown: PreparationScoreBreakdown; corrected: { status: PreparationStatus; score: number } | null };

export interface PreparationNotice {
  recordId: string;
  dateKey: string;
  status: "INCOMPLETE" | "MISSED";
  endedLength: number;
  longest: number;
}

export interface PreparationState {
  configured: boolean;
  schedule: { timezone: string; targetMinutes: number; weekdays: number[]; effectiveFrom: string } | null;
  /** A confirmed change that starts at a later local date. */
  pendingSchedule: { timezone: string; targetMinutes: number; weekdays: number[]; effectiveFrom: string } | null;
  todayKey: string | null;
  /** Point maxima of the rules governing today (frozen with the schedule version). */
  scoring: { completionMax: number; timingMax: number } | null;
  today: PreparationToday;
  streak: PreparationStreak;
  /** The streak-break notice, until acknowledged. */
  notice: PreparationNotice | null;
}

const EMPTY_STREAK: PreparationStreak = { current: 0, longest: 0, lastBreak: null, restartedAfterBreak: false };

function breakdownFromRecord(r: {
  status: PreparationStatus;
  completionPoints: number;
  timingPoints: number;
  score: number;
  requiredTotal: number;
  requiredDone: number;
  targetAt: Date;
  cutoffAt: Date;
  readyAt: Date | null;
  deviationSeconds: number | null;
  deviationMinutes: number | null;
  bandLabel: string | null;
  scoringVersion: number;
}): PreparationScoreBreakdown {
  return {
    status: r.status,
    final: true,
    completionPoints: r.completionPoints,
    timingPoints: r.timingPoints,
    score: r.score,
    requiredTotal: r.requiredTotal,
    requiredDone: r.requiredDone,
    targetAt: r.targetAt,
    cutoffAt: r.cutoffAt,
    readyAt: r.readyAt,
    deviationMs: r.deviationSeconds == null ? null : r.deviationSeconds * 1000,
    deviationMinutes: r.deviationMinutes,
    bandLabel: r.bandLabel,
    scoringVersion: r.scoringVersion,
  };
}

/**
 * Everything the (Phase 3) Today UI will need: today's state (PENDING is
 * derived, never stored), the derived streak over stored records + the
 * latest valid corrections, and the unacknowledged break notice. Read-only:
 * call `finalizePreparationDays` first to persist anything newly final.
 */
export async function getPreparationState(userId: string, now: Date = new Date()): Promise<PreparationState> {
  const versions = await getScheduleVersions(userId);
  if (versions.length === 0) {
    return {
      configured: false,
      schedule: null,
      pendingSchedule: null,
      todayKey: null,
      scoring: null,
      today: { kind: "OUTSIDE_ERA" },
      streak: EMPTY_STREAK,
      notice: null,
    };
  }
  const todayKey = await preparationTodayKey(prisma, userId, now);
  const current = scheduleVersionFor(versions, todayKey);
  const future = versions.filter((v) => v.effectiveFrom > todayKey).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)).pop() ?? null;
  const pick = (v: PreparationScheduleVersion | null) =>
    v ? { timezone: v.timezone, targetMinutes: v.targetMinutes, weekdays: v.weekdays, effectiveFrom: v.effectiveFrom } : null;

  const [records, corrections, exceptions, facts] = await Promise.all([
    prisma.preparationDayRecord.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.preparationDayCorrection.findMany({ where: { userId }, include: { record: { select: { date: true } } } }),
    prisma.preparationDayException.findMany({ where: { userId, date: dateKeyToUtcDate(todayKey) } }),
    liveDayFacts(prisma, userId, todayKey, todayKey),
  ]);

  const correctionList: PreparationCorrection[] = corrections.map((c) => ({
    dateKey: utcDateToKey(c.record.date),
    status: c.status,
    score: c.score,
    reason: c.reason,
    actor: c.actor,
    createdAt: c.createdAt,
  }));

  // Stored outcomes (+ today when not yet stored) → effective days → streak.
  const outcomes: DayOutcome[] = records.map((r) =>
    r.status === "DAY_OFF"
      ? { dateKey: utcDateToKey(r.date), kind: "EXEMPT", scheduleVersionId: r.scheduleVersionId, timezone: r.timezone, status: "DAY_OFF" }
      : { dateKey: utcDateToKey(r.date), kind: "SCORED", scheduleVersionId: r.scheduleVersionId, timezone: r.timezone, breakdown: breakdownFromRecord(r) },
  );
  const todayRecord = records.find((r) => utcDateToKey(r.date) === todayKey) ?? null;
  let today: PreparationToday;
  if (todayRecord) {
    const effective = effectiveDays(outcomes.filter((o) => o.dateKey === todayKey), correctionList)[0];
    today =
      todayRecord.status === "DAY_OFF"
        ? { kind: "DAY_OFF" }
        : {
            kind: "SCORED",
            breakdown: breakdownFromRecord(todayRecord),
            corrected: effective?.corrected && effective.status !== "PENDING" ? { status: effective.status, score: effective.score ?? 0 } : null,
          };
  } else {
    const a = dayApplicability(
      versions,
      exceptions.map((e) => ({ dateKey: utcDateToKey(e.date), kind: e.kind, createdAt: e.createdAt })),
      todayKey,
    );
    if (a.kind === "OUTSIDE_ERA" || a.kind === "NOT_SCHEDULED" || a.kind === "DAY_OFF") {
      today = { kind: a.kind };
    } else {
      const r = scorePreparationDay(a.version.rules, a.instants, facts.get(todayKey) ?? { firstReadyAt: null, requiredItems: [] }, now);
      // A final outcome not stored yet (finalize not run) is still shown as its breakdown.
      today = r.status === "PENDING" ? { kind: "PENDING", pending: r } : { kind: "SCORED", breakdown: r, corrected: null };
      if (r.status !== "PENDING") {
        outcomes.push({ dateKey: todayKey, kind: "SCORED", scheduleVersionId: a.version.id, timezone: a.version.timezone, breakdown: r });
      }
    }
  }

  const days: EffectiveDay[] = effectiveDays(outcomes, correctionList);
  const streak = derivePreparationStreak(days);
  return {
    configured: true,
    schedule: pick(current),
    pendingSchedule: pick(future),
    todayKey,
    scoring: current ? { completionMax: current.rules.completionMax, timingMax: current.rules.timingMax } : null,
    today,
    streak,
    notice: noticeFor(streak.lastBreak, streak.longest, records),
  };
}

/** The break notice exists only for an INCOMPLETE/MISSED that ended a streak ≥ 1, until acknowledged. */
function noticeFor(
  lastBreak: StreakBreak | null,
  longest: number,
  records: { id: string; date: Date; noticeAcknowledgedAt: Date | null }[],
): PreparationNotice | null {
  if (!lastBreak || lastBreak.endedLength < 1) return null;
  const record = records.find((r) => utcDateToKey(r.date) === lastBreak.dateKey);
  if (!record || record.noticeAcknowledgedAt) return null;
  return { recordId: record.id, dateKey: lastBreak.dateKey, status: lastBreak.status, endedLength: lastBreak.endedLength, longest };
}

/** Dismisses a streak-break notice. Touches only noticeAcknowledgedAt (once) — never the outcome or streak. */
export async function acknowledgePreparationNotice(userId: string, recordId: string, now: Date = new Date()): Promise<void> {
  await prisma.preparationDayRecord.updateMany({ where: { id: recordId, userId, noticeAcknowledgedAt: null }, data: { noticeAcknowledgedAt: now } });
}

// ── Settings read model (Phase 3) ───────────────────────────────────────────

export interface PreparationScheduleSummary {
  timezone: string;
  targetMinutes: number;
  weekdays: number[];
  effectiveFrom: string;
}

export interface PreparationScheduleOverview {
  todayKey: string;
  /** The version governing today (null before the first version starts). */
  current: PreparationScheduleSummary | null;
  /** The confirmed version that starts at a later local date, if any. */
  upcoming: PreparationScheduleSummary | null;
  /** The date a change confirmed now would take effect. */
  nextEffectiveFrom: string;
  /** DAY_OFF / EXTRA_DAY exceptions dated today or later, ascending. */
  upcomingExceptions: { id: string; dateKey: string; kind: "DAY_OFF" | "EXTRA_DAY"; note: string | null }[];
}

/** Settings → Routine → Preparation Schedule. Read-only; scope-independent (schedules are live-only). */
export async function getPreparationScheduleOverview(userId: string, now: Date = new Date()): Promise<PreparationScheduleOverview> {
  const [versions, tzVersions] = await Promise.all([getScheduleVersions(userId), timezoneVersions(prisma, userId)]);
  const todayKey = traderTodayKey(tzVersions, now);
  const current = scheduleVersionFor(versions, todayKey);
  const upcoming = versions.filter((v) => v.effectiveFrom > todayKey).reduce<PreparationScheduleVersion | null>(
    (best, v) => (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.createdAt > best.createdAt) ? v : best),
    null,
  );
  const exceptions = versions.length
    ? await prisma.preparationDayException.findMany({
        where: { userId, date: { gte: dateKeyToUtcDate(todayKey) } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const pick = (v: PreparationScheduleVersion | null): PreparationScheduleSummary | null =>
    v ? { timezone: v.timezone, targetMinutes: v.targetMinutes, weekdays: v.weekdays, effectiveFrom: v.effectiveFrom } : null;
  // A change that ended up identical to today's schedule (e.g. a timezone
  // change confirmed and then cancelled) is not an "upcoming" change.
  const same =
    current &&
    upcoming &&
    current.timezone === upcoming.timezone &&
    current.targetMinutes === upcoming.targetMinutes &&
    current.weekdays.join(",") === upcoming.weekdays.join(",");
  return {
    todayKey,
    current: pick(current),
    upcoming: same ? null : pick(upcoming),
    nextEffectiveFrom: nextEffectiveDate(todayKey),
    upcomingExceptions: exceptions.map((e) => ({ id: e.id, dateKey: utcDateToKey(e.date), kind: e.kind, note: e.note })),
  };
}

/** Finalize (LIVE) then read — the Today loader's single call. */
export async function loadPreparationState(userId: string, now: Date = new Date()): Promise<PreparationState> {
  await finalizePreparationDays(userId, now);
  return getPreparationState(userId, now);
}
