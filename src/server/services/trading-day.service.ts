import type { TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
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
