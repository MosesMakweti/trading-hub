import { Prisma, type TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { isDayEditable } from "@/domain/today/archive";
import type { TodaysPlanInput } from "@/lib/validation/today";
import type { TradingDayDTO } from "@/types/today";

/**
 * Get-or-create the TradingDay record for a user's day (the Today workspace
 * backbone). Idempotent + concurrency-safe via upsert on the (userId, date)
 * unique. TradingDay has no soft delete — a day is archived, never removed.
 */
export async function getOrCreateTradingDay(userId: string, dateKey: string): Promise<TradingDay> {
  const date = dateKeyToUtcDate(dateKey);
  return prisma.tradingDay.upsert({
    where: { userId_date: { userId, date } },
    update: {},
    create: { userId, date },
  });
}

/** Read-only lookup (no create) — used where a view should reflect the day's
 *  state without starting it (e.g. the Dashboard). Null if the day hasn't begun. */
export async function getTradingDay(userId: string, dateKey: string): Promise<TradingDay | null> {
  return prisma.tradingDay.findFirst({ where: { userId, date: dateKeyToUtcDate(dateKey) } });
}

/** Thrown by {@link assertDayEditable} when a mutation targets an archived day. */
export class DayArchivedError extends Error {
  constructor() {
    super("This day is archived — reopen it to make changes.");
    this.name = "DayArchivedError";
  }
}

/**
 * Read-only enforcement: rejects a mutation to a date whose TradingDay has been
 * archived. Called at the top of every dated mutation so an archived day is
 * immutable regardless of which surface the write comes from (defense in depth,
 * mirroring the userId scoping elsewhere). Days with no TradingDay row are
 * editable. Reopen (reopenDay) lifts the lock.
 */
export async function assertDayEditable(userId: string, dateKey: string): Promise<void> {
  const day = await getTradingDay(userId, dateKey);
  if (!isDayEditable(day)) throw new DayArchivedError();
}

/**
 * Applies a Today's Trading Plan patch.
 * `planComplete` toggles the day's planCompletedAt so the workflow advances.
 */
export async function updateTodaysPlan(
  userId: string,
  dateKey: string,
  input: TodaysPlanInput,
): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);

  const data: Prisma.TradingDayUpdateInput = {};
  if ("bias" in input) data.bias = input.bias ?? null;
  if ("conviction" in input) data.conviction = input.conviction ?? null;
  if ("keyLevels" in input) {
    data.keyLevels =
      input.keyLevels == null ? Prisma.DbNull : (input.keyLevels as Prisma.InputJsonValue);
  }
  if ("riskBudgetPercent" in input) data.riskBudgetPercent = input.riskBudgetPercent ?? null;
  if ("planComplete" in input) data.planCompletedAt = input.planComplete ? new Date() : null;

  return prisma.tradingDay.update({ where: { id: day.id }, data });
}

/** Marks the day as reviewed/analysed (toggles analyzedAt) — advances the
 *  workflow's Analyze step. */
export async function setDayAnalyzed(
  userId: string,
  dateKey: string,
  analyzed: boolean,
): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  return prisma.tradingDay.update({
    where: { id: day.id },
    data: { analyzedAt: analyzed ? new Date() : null },
  });
}

/** Finalize a day → it becomes a read-only journal entry (Phase 6). */
export async function endDay(userId: string, dateKey: string): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  return prisma.tradingDay.update({
    where: { id: day.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

/** Reopen an archived day for more edits (un-archive). */
export async function reopenDay(userId: string, dateKey: string): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  return prisma.tradingDay.update({
    where: { id: day.id },
    data: { status: "ACTIVE", archivedAt: null },
  });
}

/**
 * Auto-archive on date rollover: any still-ACTIVE day older than today is
 * finalized the next time the user opens the Today workspace. TradingDays only
 * exist for days the user actually opened, so this only touches real past days.
 * Returns how many were archived.
 */
export async function archivePastActiveDays(userId: string, todayKey: string): Promise<number> {
  const { count } = await prisma.tradingDay.updateMany({
    where: { userId, status: "ACTIVE", date: { lt: dateKeyToUtcDate(todayKey) } },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  return count;
}

export function toTradingDayDTO(day: TradingDay): TradingDayDTO {
  return {
    id: day.id,
    dateKey: utcDateToKey(day.date),
    status: day.status,
    prepCompletedAt: day.prepCompletedAt?.toISOString() ?? null,
    planCompletedAt: day.planCompletedAt?.toISOString() ?? null,
    analyzedAt: day.analyzedAt?.toISOString() ?? null,
    archivedAt: day.archivedAt?.toISOString() ?? null,
  };
}
