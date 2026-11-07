import { Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { runLive } from "@/server/workspace/scope";
import { computeDiscipline } from "@/server/services/discipline-streaks.service";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { addDaysToDateKey, traderTodayKey, type TimezoneVersion } from "@/domain/time/trader-calendar";
import { getTimezoneVersions } from "@/server/services/trader-time.service";
import { traderDateKeyOf } from "@/domain/discipline/streaks/calendar";
import { dateKeysBetween } from "@/domain/discipline/streaks/calendar";
import { deriveDailyStreak } from "@/domain/discipline/streaks/streak";
import {
  computeGoalProgress,
  progressPercent,
  projectedCompletionDate,
  remainingDays,
  requirementCatalogueEntry,
  requirementSetProblem,
  requirementsOn,
  richTextHasContent,
  type GoalActivityFacts,
  type GoalDayContext,
  type GoalDayRecord,
  type GoalDefinition,
  type GoalProgress,
  type GoalRequirementType,
  type RequirementDayResult,
} from "@/domain/goals";
import { GOAL_MAX_START_AHEAD_DAYS, type CreateGoalInput, type GoalRequirementInput, type UpdateGoalInput } from "@/lib/validation/goals";
import type { ActiveGoalDTO, GoalDayDTO, GoalHistoryDTO, GoalRequirementDTO, GoalsOverviewDTO } from "@/types/goals";

/**
 * Goals — one consecutive trading-day commitment at a time (LIVE only).
 *
 *   existing activity records → domain/goals (pure) → GoalDay (final, immutable)
 *
 * Progress is derived from what Traditorium already records; only custom
 * check-ins are stored here. A date becomes FINAL once it is past and
 * decided, is then written to GoalDay exactly once (unique (goalId, date) +
 * a write-once trigger) and is never re-evaluated. `processGoalProgress` is
 * idempotent and runs whenever goal data is read, so days that ended while
 * the trader was away are finalized on their next visit.
 *
 * One open goal per user: a per-user advisory lock around every write, plus
 * the partial unique index "Goal_open_userId_key" as the last line of defence.
 */

/** Pause days allowed per goal; an open pause ends by itself once they are used. */
export const GOAL_PAUSE_LIMIT_DAYS = 7;

export class GoalError extends Error {
  constructor(
    message: string,
    readonly code: "OPEN_GOAL_EXISTS" | "NOT_FOUND" | "INVALID" | "CONFLICT",
  ) {
    super(message);
    this.name = "GoalError";
  }
}

const OPEN_STATUSES = ["ACTIVE", "PAUSED"] as const;

type Tx = TransactionClient;

const goalInclude = {
  requirements: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
  pauses: { orderBy: { fromDate: "asc" } },
  days: { orderBy: { date: "asc" } },
} satisfies Prisma.GoalInclude;

type GoalRow = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`goals:${userId}`}, 0))`;
}

function isOpenGoalConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ── Facts ───────────────────────────────────────────────────────────────────

interface LoadedFacts {
  facts: Omit<GoalActivityFacts, "checkIns">;
  ctx: GoalDayContext;
  todayKey: string;
}

/** Everything the requirement evaluators read, from the existing records. */
async function loadActivity(userId: string, now: Date): Promise<LoadedFacts> {
  const c = await computeDiscipline(userId, now);
  const notes = await runLive(() =>
    prisma.dailyNote.findMany({ where: { userId, backtestRunId: null }, select: { date: true, content: true } }),
  );
  const journalDates = new Set(notes.filter((n) => richTextHasContent(n.content)).map((n) => utcDateToKey(n.date)));
  const routine = new Map<string, { preSession: boolean; postSession: boolean }>();
  for (const [k, r] of c.routineDays) routine.set(k, { preSession: r.preSession, postSession: r.postSession });
  return {
    todayKey: c.todayKey,
    facts: { todayKey: c.todayKey, routine, trades: c.trades, journalDates },
    ctx: { requirement: c.dayRequirement, skipped: c.skipped },
  };
}

async function loadCheckIns(goalId: string): Promise<Set<string>> {
  const rows = await prisma.goalCheckIn.findMany({ where: { goalId }, select: { requirementId: true, date: true } });
  return new Set(rows.map((r) => `${r.requirementId}|${utcDateToKey(r.date)}`));
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function toDefinition(g: GoalRow): GoalDefinition {
  return {
    startDate: utcDateToKey(g.startDate),
    targetDays: g.targetDays,
    requirements: g.requirements.map((r) => ({
      id: r.id,
      type: r.type as GoalRequirementType,
      label: r.label,
      mandatory: r.mandatory,
      effectiveFrom: utcDateToKey(r.effectiveFrom),
      retiredFrom: r.retiredFrom ? utcDateToKey(r.retiredFrom) : null,
    })),
    pauses: g.pauses.map((p) => ({ fromDate: utcDateToKey(p.fromDate), toDate: p.toDate ? utcDateToKey(p.toDate) : null })),
  };
}

function toStored(g: GoalRow): GoalDayRecord[] {
  return g.days.map((d) => ({
    dateKey: utcDateToKey(d.date),
    status: d.status,
    attempt: d.attempt,
    streakAfter: d.streakAfter,
    results: (d.results as unknown as RequirementDayResult[]) ?? [],
  }));
}

/** Days between two keys, `from` inclusive, `to` exclusive. */
function daysBetween(from: string, to: string): number {
  return to <= from ? 0 : dateKeysBetween(from, addDaysToDateKey(to, -1)).length;
}

function pauseDaysUsed(pauses: GoalDefinition["pauses"], todayKey: string): number {
  return pauses.reduce((n, p) => n + daysBetween(p.fromDate, p.toDate ?? addDaysToDateKey(todayKey, 1)), 0);
}

function requirementTitle(type: GoalRequirementType, label: string | null): string {
  return type === "CUSTOM_CHECKIN" && label ? label : requirementCatalogueEntry(type).title;
}

// ── Processing ──────────────────────────────────────────────────────────────

interface ProcessedGoal {
  goal: GoalRow;
  progress: GoalProgress;
  todayKey: string;
  ctx: GoalDayContext;
}

/**
 * Finalizes every past, decided day of the open goal, ends a pause that has
 * used its allowance, and completes the goal when a final day reaches the
 * target. Idempotent; safe to call concurrently. Returns null without an
 * open goal.
 */
export async function processGoalProgress(userId: string, now: Date = new Date()): Promise<ProcessedGoal | null> {
  const open = await prisma.goal.findFirst({ where: { userId, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
  if (!open) return null;

  const loaded = await loadActivity(userId, now);
  const checkIns = await loadCheckIns(open.id);
  const facts: GoalActivityFacts = { ...loaded.facts, checkIns };
  const { todayKey } = loaded;

  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    let goal = await tx.goal.findFirst({ where: { id: open.id, userId }, include: goalInclude });
    if (!goal || (goal.status !== "ACTIVE" && goal.status !== "PAUSED")) {
      return null;
    }

    // A pause that has used the allowance ends by itself.
    const openPause = goal.pauses.find((p) => p.toDate == null);
    if (goal.status === "PAUSED" && openPause) {
      const def = toDefinition(goal);
      const usedBefore = pauseDaysUsed(def.pauses.filter((p) => p.toDate != null), todayKey);
      const endsOn = addDaysToDateKey(utcDateToKey(openPause.fromDate), Math.max(0, GOAL_PAUSE_LIMIT_DAYS - usedBefore));
      if (endsOn <= todayKey) {
        await tx.goalPause.update({ where: { id: openPause.id }, data: { toDate: dateKeyToUtcDate(endsOn) } });
        await tx.goal.update({ where: { id: goal.id }, data: { status: "ACTIVE" } });
        goal = (await tx.goal.findFirst({ where: { id: goal.id }, include: goalInclude }))!;
      }
    }

    const def = toDefinition(goal);
    const progress = computeGoalProgress(def, toStored(goal), facts, loaded.ctx);

    if (progress.toFinalize.length > 0) {
      await tx.goalDay.createMany({
        data: progress.toFinalize.map((d) => ({
          goalId: goal.id,
          userId,
          date: dateKeyToUtcDate(d.dateKey),
          status: d.status,
          attempt: d.attempt,
          streakAfter: d.streakAfter,
          results: d.results as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    if (progress.completedOn) {
      await tx.goal.update({
        where: { id: goal.id },
        data: { status: "COMPLETED", completedOn: dateKeyToUtcDate(progress.completedOn), completedAt: now },
      });
    }
    const fresh = (await tx.goal.findFirst({ where: { id: goal.id }, include: goalInclude }))!;
    return { goal: fresh, progress, todayKey, ctx: loaded.ctx };
  });
}

// ── Read model ──────────────────────────────────────────────────────────────

function dayDTO(d: GoalProgress["days"][number]): GoalDayDTO {
  return {
    dateKey: d.dateKey,
    status: d.status,
    final: d.final,
    attempt: d.attempt,
    streakAfter: d.streakAfter,
    results: d.results.map((r) => ({
      requirementId: r.requirementId,
      type: r.type,
      title: requirementTitle(r.type, r.label),
      mandatory: r.mandatory,
      result: r.result,
      reasons: r.reasons,
    })),
  };
}

function activeDTO(p: ProcessedGoal): ActiveGoalDTO {
  const { goal, progress, todayKey, ctx } = p;
  const def = toDefinition(goal);
  const started = def.startDate <= todayKey;
  const reqDate = started ? todayKey : def.startDate;
  const requirements: GoalRequirementDTO[] = requirementsOn(def, reqDate).map((r) => ({
    id: r.id,
    type: r.type,
    title: requirementTitle(r.type, r.label),
    label: r.label,
    mandatory: r.mandatory,
  }));
  const remaining = remainingDays(goal.targetDays, progress.currentStreak);
  const isTradingDay = (k: string) => ctx.requirement(k) === "REQUIRED" && !ctx.skipped.has(k);
  const projectionStart = started ? todayKey : def.startDate;
  const used = pauseDaysUsed(def.pauses, todayKey);
  const openPause = def.pauses.find((x) => x.toDate == null) ?? null;

  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    category: goal.category,
    status: goal.status as "ACTIVE" | "PAUSED",
    startDate: def.startDate,
    targetDays: goal.targetDays,
    requirements,
    currentStreak: progress.currentStreak,
    longestStreak: progress.longestStreak,
    successfulDays: progress.successfulDays,
    missedDays: progress.missedDays,
    attempt: progress.attempt,
    attemptStartedOn: progress.attemptStartedOn,
    progressPercent: progressPercent(goal.targetDays, progress.currentStreak),
    remainingDays: remaining,
    projectedCompletion:
      goal.status === "PAUSED"
        ? null
        : projectedCompletionDate(remaining, projectionStart, started && progress.today?.status === "QUALIFIED", isTradingDay),
    started,
    today: progress.today ? dayDTO({ ...progress.today, attempt: progress.attempt, streakAfter: progress.currentStreak }) : null,
    days: progress.days.map(dayDTO),
    pause: {
      pausedSince: openPause?.fromDate ?? null,
      daysUsed: Math.min(used, GOAL_PAUSE_LIMIT_DAYS),
      daysLeft: Math.max(0, GOAL_PAUSE_LIMIT_DAYS - used),
      limit: GOAL_PAUSE_LIMIT_DAYS,
    },
  };
}

function historyDTO(g: Prisma.GoalGetPayload<{ include: { days: true } }>, tz: readonly TimezoneVersion[]): GoalHistoryDTO {
  const days = [...g.days].sort((a, b) => a.date.getTime() - b.date.getTime());
  const s = deriveDailyStreak(
    days.map((d) => ({
      dateKey: utcDateToKey(d.date),
      status: d.status === "QUALIFIED" ? "ACTIVE" : d.status === "MISSED" ? "MISSED" : "REST",
    })),
  );
  const ended = g.completedOn ? utcDateToKey(g.completedOn) : traderDateKeyOf(tz, g.abandonedAt ?? g.updatedAt);
  return {
    id: g.id,
    name: g.name,
    category: g.category,
    status: g.status as "COMPLETED" | "ABANDONED",
    targetDays: g.targetDays,
    startDate: utcDateToKey(g.startDate),
    endedOn: ended,
    longestStreak: s.longest,
    successfulDays: s.activeDays,
    missedDays: days.filter((d) => d.status === "MISSED").length,
    attempts: days.reduce((m, d) => Math.max(m, d.attempt), 0),
  };
}

/** The trader's goals: the open one (processed first), history and personal totals. */
export async function getGoalsOverview(userId: string, now: Date = new Date()): Promise<GoalsOverviewDTO> {
  const processed = await processGoalProgress(userId, now);
  const [closed, stored, tz] = await Promise.all([
    prisma.goal.findMany({
      where: { userId, status: { in: ["COMPLETED", "ABANDONED"] } },
      include: { days: true },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.goalDay.aggregate({ where: { userId }, _max: { streakAfter: true } }),
    getTimezoneVersions(userId),
  ]);
  const qualifiedStored = await prisma.goalDay.count({ where: { userId, status: "QUALIFIED" } });

  const active = processed && (processed.goal.status === "ACTIVE" || processed.goal.status === "PAUSED") ? activeDTO(processed) : null;
  const liveExtra = processed ? processed.progress.days.filter((d) => !d.final && d.status === "QUALIFIED").length : 0;
  const todayKey = processed?.todayKey ?? traderTodayKey(tz, now);

  return {
    todayKey,
    active,
    history: closed.map((g) => historyDTO(g, tz)),
    stats: {
      current: active?.currentStreak ?? 0,
      longest: Math.max(stored._max.streakAfter ?? 0, active?.longestStreak ?? 0),
      successfulDays: qualifiedStored + liveExtra,
      goalsCompleted: closed.filter((g) => g.status === "COMPLETED").length,
      goalsAbandoned: closed.filter((g) => g.status === "ABANDONED").length,
    },
  };
}

async function computeTodayKey(userId: string, now: Date): Promise<string> {
  return traderTodayKey(await getTimezoneVersions(userId), now);
}

// ── Commands ────────────────────────────────────────────────────────────────

function checkRequirements(reqs: GoalRequirementInput[]): void {
  const problem = requirementSetProblem(
    reqs.map((r) => ({ type: r.type, label: r.label ?? null, mandatory: r.mandatory })),
    (t) => requirementCatalogueEntry(t).everyTradingDay,
  );
  if (problem) throw new GoalError(problem, "INVALID");
}

function requirementRows(goalId: string, reqs: GoalRequirementInput[], effectiveFrom: string) {
  return reqs.map((r, i) => ({
    goalId,
    type: r.type,
    label: r.type === "CUSTOM_CHECKIN" ? (r.label?.trim() ?? null) : null,
    mandatory: r.mandatory,
    position: i,
    effectiveFrom: dateKeyToUtcDate(effectiveFrom),
  }));
}

/** Creates the trader's goal. Refused while another goal is ACTIVE or PAUSED. */
export async function createGoal(userId: string, input: CreateGoalInput, now: Date = new Date()): Promise<{ id: string }> {
  checkRequirements(input.requirements);
  const todayKey = await runLive(() => computeTodayKey(userId, now));
  if (input.startDate < todayKey) throw new GoalError("A goal starts today or later — it can't be back-dated.", "INVALID");
  if (input.startDate > addDaysToDateKey(todayKey, GOAL_MAX_START_AHEAD_DAYS)) {
    throw new GoalError(`A goal can start at most ${GOAL_MAX_START_AHEAD_DAYS} days ahead.`, "INVALID");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const existing = await tx.goal.findFirst({ where: { userId, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });
      if (existing) throw new GoalError("You already have a goal in progress. Complete or abandon it before starting another.", "OPEN_GOAL_EXISTS");
      const goal = await tx.goal.create({
        data: {
          userId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          category: input.category,
          targetDays: input.targetDays,
          startDate: dateKeyToUtcDate(input.startDate),
        },
        select: { id: true },
      });
      await tx.goalRequirement.createMany({ data: requirementRows(goal.id, input.requirements, input.startDate) });
      return goal;
    });
  } catch (e) {
    if (isOpenGoalConflict(e)) {
      throw new GoalError("You already have a goal in progress. Complete or abandon it before starting another.", "OPEN_GOAL_EXISTS");
    }
    throw e;
  }
}

async function requireOpenGoal(tx: Tx, userId: string, goalId: string): Promise<GoalRow> {
  const goal = await tx.goal.findFirst({ where: { id: goalId, userId }, include: goalInclude });
  if (!goal) throw new GoalError("Goal not found.", "NOT_FOUND");
  if (goal.status !== "ACTIVE" && goal.status !== "PAUSED") throw new GoalError("This goal is already closed.", "CONFLICT");
  return goal;
}

function sameRequirements(current: GoalRequirementInput[], next: GoalRequirementInput[]): boolean {
  const key = (r: GoalRequirementInput) => `${r.type}|${r.type === "CUSTOM_CHECKIN" ? (r.label ?? "").trim() : ""}|${r.mandatory}`;
  return current.length === next.length && current.every((r, i) => key(r) === key(next[i]));
}

/**
 * Edits the open goal. Name, description and category change at once.
 * Requirement changes apply from tomorrow (or the start date, before the
 * goal begins) so every past day keeps the rules it was judged by. The
 * target may grow, or shrink to just above the current streak.
 */
export async function updateGoal(userId: string, goalId: string, input: UpdateGoalInput, now: Date = new Date()): Promise<void> {
  if (input.requirements) checkRequirements(input.requirements);
  const processed = await processGoalProgress(userId, now);
  if (!processed || processed.goal.id !== goalId) {
    const exists = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { status: true } });
    if (!exists) throw new GoalError("Goal not found.", "NOT_FOUND");
    throw new GoalError("This goal is already closed.", "CONFLICT");
  }
  const { todayKey } = processed;
  const current = processed.progress.currentStreak;

  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const goal = await requireOpenGoal(tx, userId, goalId);
    if (input.targetDays != null && input.targetDays <= current) {
      throw new GoalError(`Your current streak is ${current} days, so the target must be more than ${current}.`, "INVALID");
    }
    await tx.goal.update({
      where: { id: goal.id },
      data: {
        ...(input.name != null ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.category != null ? { category: input.category } : {}),
        ...(input.targetDays != null ? { targetDays: input.targetDays } : {}),
      },
    });

    if (input.requirements) {
      const def = toDefinition(goal);
      const started = def.startDate <= todayKey;
      const effectiveFrom = started ? addDaysToDateKey(todayKey, 1) : def.startDate;
      const inForce = requirementsOn(def, effectiveFrom).map((r) => ({ type: r.type, label: r.label, mandatory: r.mandatory }));
      if (sameRequirements(inForce, input.requirements)) return;
      if (!started) {
        await tx.goalRequirement.deleteMany({ where: { goalId: goal.id } });
      } else {
        // Versions that would only have started tomorrow are replaced outright.
        await tx.goalRequirement.deleteMany({ where: { goalId: goal.id, effectiveFrom: { gte: dateKeyToUtcDate(effectiveFrom) } } });
        await tx.goalRequirement.updateMany({
          where: { goalId: goal.id, retiredFrom: null },
          data: { retiredFrom: dateKeyToUtcDate(effectiveFrom) },
        });
      }
      await tx.goalRequirement.createMany({ data: requirementRows(goal.id, input.requirements, effectiveFrom) });
    }
  });
}

/** Pauses the open goal from today. Paused days neither count nor break the streak. */
export async function pauseGoal(userId: string, goalId: string, now: Date = new Date()): Promise<void> {
  const processed = await processGoalProgress(userId, now);
  const todayKey = processed?.todayKey ?? (await runLive(() => computeTodayKey(userId, now)));
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const goal = await requireOpenGoal(tx, userId, goalId);
    if (goal.status === "PAUSED") throw new GoalError("This goal is already paused.", "CONFLICT");
    const def = toDefinition(goal);
    if (def.startDate > todayKey) throw new GoalError("A goal can only be paused once it has started.", "INVALID");
    if (pauseDaysUsed(def.pauses, addDaysToDateKey(todayKey, -1)) >= GOAL_PAUSE_LIMIT_DAYS) {
      throw new GoalError(`This goal has used all ${GOAL_PAUSE_LIMIT_DAYS} pause days.`, "INVALID");
    }
    // Pausing and resuming the same day leaves an empty interval: reuse it.
    await tx.goalPause.deleteMany({ where: { goalId: goal.id, fromDate: dateKeyToUtcDate(todayKey), toDate: dateKeyToUtcDate(todayKey) } });
    await tx.goalPause.create({ data: { goalId: goal.id, fromDate: dateKeyToUtcDate(todayKey) } });
    await tx.goal.update({ where: { id: goal.id }, data: { status: "PAUSED" } });
  });
}

/** Resumes a paused goal from today; the current attempt continues. */
export async function resumeGoal(userId: string, goalId: string, now: Date = new Date()): Promise<void> {
  const processed = await processGoalProgress(userId, now);
  const todayKey = processed?.todayKey ?? (await runLive(() => computeTodayKey(userId, now)));
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const goal = await requireOpenGoal(tx, userId, goalId);
    if (goal.status !== "PAUSED") throw new GoalError("This goal isn't paused.", "CONFLICT");
    await tx.goalPause.updateMany({ where: { goalId: goal.id, toDate: null }, data: { toDate: dateKeyToUtcDate(todayKey) } });
    await tx.goal.update({ where: { id: goal.id }, data: { status: "ACTIVE" } });
  });
}

/**
 * Abandons the open goal. Its finalized days stay in history; today, which
 * is still open, is not recorded. A new goal can be created straight away.
 */
export async function abandonGoal(userId: string, goalId: string, now: Date = new Date()): Promise<void> {
  const processed = await processGoalProgress(userId, now);
  const todayKey = processed?.todayKey ?? (await runLive(() => computeTodayKey(userId, now)));
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const goal = await requireOpenGoal(tx, userId, goalId);
    await tx.goalPause.updateMany({ where: { goalId: goal.id, toDate: null }, data: { toDate: dateKeyToUtcDate(todayKey) } });
    await tx.goal.update({ where: { id: goal.id }, data: { status: "ABANDONED", abandonedAt: now } });
  });
}

/**
 * Ticks (or unticks) a custom check-in for today or yesterday. A date that
 * is already final can no longer change.
 */
export async function setGoalCheckIn(
  userId: string,
  input: { goalId: string; requirementId: string; dateKey: string; checked: boolean },
  now: Date = new Date(),
): Promise<void> {
  const todayKey = await runLive(() => computeTodayKey(userId, now));
  if (input.dateKey !== todayKey && input.dateKey !== addDaysToDateKey(todayKey, -1)) {
    throw new GoalError("Check-ins can only be recorded for today or yesterday.", "INVALID");
  }
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const goal = await requireOpenGoal(tx, userId, input.goalId);
    const def = toDefinition(goal);
    const req = requirementsOn(def, input.dateKey).find((r) => r.id === input.requirementId);
    if (!req || req.type !== "CUSTOM_CHECKIN") throw new GoalError("That check-in isn't part of this goal on that day.", "INVALID");
    if (input.dateKey < def.startDate) throw new GoalError("The goal hasn't started on that day.", "INVALID");
    const date = dateKeyToUtcDate(input.dateKey);
    const final = await tx.goalDay.findUnique({ where: { goalId_date: { goalId: goal.id, date } }, select: { id: true } });
    if (final) throw new GoalError("That day is already final and can't change.", "CONFLICT");
    if (input.checked) {
      await tx.goalCheckIn.createMany({ data: [{ goalId: goal.id, requirementId: req.id, date }], skipDuplicates: true });
    } else {
      await tx.goalCheckIn.deleteMany({ where: { requirementId: req.id, date } });
    }
  });
}
