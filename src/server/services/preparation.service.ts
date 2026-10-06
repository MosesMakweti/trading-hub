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
import { addDaysToDateKey, effectiveTimezoneAt, isValidTimeZone, localDateKeyAt, traderTodayKey } from "@/domain/time/trader-calendar";
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
  /** Defaults to the trader's confirmed timezone (trader-time.service). */
  timezone?: string;
  targetMinutes: number;
  weekdays: number[];
}

/**
 * Confirms the Preparation Schedule. Always appends a NEW immutable version
 * effective from the trader's NEXT local date — today's (and every past)
 * outcome is never rewritten. Re-confirming the schedule already in place
 * for that date is a no-op (double submits never duplicate versions).
 */
export async function confirmPreparationSchedule(userId: string, input: ConfirmScheduleInput, now: Date = new Date()) {
  if (isBacktestScope()) throw new PreparationError("The Preparation Schedule is set from the live workspace.");
  return prisma.$transaction(async (tx) => {
    await lock(tx, `prep-schedule:${userId}`);
    const tzVersions = await tx.traderTimezoneVersion.findMany({ where: { userId }, select: { timezone: true, effectiveFrom: true, createdAt: true } });
    const timezone = (input.timezone ?? effectiveTimezoneAt(tzVersions, now)).trim();
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
        createdAt: now,
      },
    });
    return { created: true, version: toDomainVersion(row) };
  });
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

function scheduleTodayKey(versions: PreparationScheduleVersion[], now: Date): string {
  const latest = versions.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom || (b.effectiveFrom === a.effectiveFrom && b.createdAt > a.createdAt) ? b : a));
  const probe = localDateKeyAt(now, latest.timezone);
  return localDateKeyAt(now, (scheduleVersionFor(versions, probe) ?? latest).timezone);
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
    const todayKey = scheduleTodayKey(versions, now);
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
    return { configured: false, schedule: null, pendingSchedule: null, todayKey: null, today: { kind: "OUTSIDE_ERA" }, streak: EMPTY_STREAK, notice: null };
  }
  const todayKey = scheduleTodayKey(versions, now);
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

/** Finalize (LIVE) then read — the Today loader's single call. */
export async function loadPreparationState(userId: string, now: Date = new Date()): Promise<PreparationState> {
  await finalizePreparationDays(userId, now);
  return getPreparationState(userId, now);
}
