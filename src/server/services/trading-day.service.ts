import { Prisma, type TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import type { MorningPrepInput, TodaysPlanInput } from "@/lib/validation/today";
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

/**
 * Applies a Morning Preparation patch to the user's day (P3). Ensures the day
 * exists first, then writes only the provided keys. `prepComplete` toggles the
 * day's prepCompletedAt so the workflow advances. userId-scoped via the
 * get-or-create.
 */
export async function updateMorningPrep(
  userId: string,
  dateKey: string,
  input: MorningPrepInput,
): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);

  const data: Prisma.TradingDayUpdateInput = {};
  if ("routineCompletion" in input) {
    data.routineCompletion = (input.routineCompletion ?? []) as Prisma.InputJsonValue;
  }
  if ("marketContext" in input) {
    data.marketContext =
      input.marketContext == null ? Prisma.DbNull : (input.marketContext as Prisma.InputJsonValue);
  }
  if ("readiness" in input) data.readiness = input.readiness ?? null;
  if ("prepComplete" in input) data.prepCompletedAt = input.prepComplete ? new Date() : null;

  return prisma.tradingDay.update({ where: { id: day.id }, data });
}

/**
 * Applies a Today's Trading Plan patch (P4) — mirrors updateMorningPrep.
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
  if ("watchlistFocus" in input) {
    data.watchlistFocus = (input.watchlistFocus ?? []) as Prisma.InputJsonValue;
  }
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
