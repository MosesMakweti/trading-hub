import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { getTradingDay } from "@/server/services/trading-day.service";
import { getDailyAnalytics } from "@/server/services/analytics.service";
import { listChecklistItems } from "@/server/services/checklist-items.service";
import { listAssets } from "@/server/services/assets.service";
import type { DailyNoteInput } from "@/lib/validation/journal";
import type { JournalDayRecapDTO } from "@/types/today";

export async function getDailyNote(userId: string, dateKey: string) {
  return prisma.dailyNote.findFirst({
    where: { userId, date: dateKeyToUtcDate(dateKey) },
  });
}

export async function upsertDailyNote(userId: string, dateKey: string, data: DailyNoteInput) {
  const date = dateKeyToUtcDate(dateKey);
  const content = (data.content ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  return prisma.dailyNote.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, content },
    update: { content },
  });
}

/**
 * Read-only recap of a day's workflow for the Journal day page (P7). Returns
 * null when no TradingDay exists for that day (it was never opened in the Today
 * workspace) — the journal then shows just notes + trades as before. Reuses the
 * pre-session-routine template, the watchlist (Assets), and the day-scoped
 * analytics service.
 */
export async function getJournalDayRecap(
  userId: string,
  dateKey: string,
): Promise<JournalDayRecapDTO | null> {
  const day = await getTradingDay(userId, dateKey);
  if (!day) return null;

  const [routineItems, assets, analytics] = await Promise.all([
    listChecklistItems(userId, "PRE_SESSION_ROUTINE"),
    listAssets(userId),
    getDailyAnalytics(userId, dateKey),
  ]);

  const completedIds = new Set((day.routineCompletion as string[] | null) ?? []);
  const watchlistIds = new Set((day.watchlistFocus as string[] | null) ?? []);

  return {
    status: day.status,
    prepDone: day.prepCompletedAt != null,
    planDone: day.planCompletedAt != null,
    analyzeDone: day.analyzedAt != null,
    prep: {
      routineTotal: routineItems.length,
      routineDone: routineItems.filter((i) => completedIds.has(i.id)).length,
      marketContext: day.marketContext,
      readiness: day.readiness,
    },
    plan: {
      bias: (day.bias as JournalDayRecapDTO["plan"]["bias"]) ?? null,
      conviction: day.conviction,
      watchlistSymbols: assets.filter((a) => watchlistIds.has(a.id)).map((a) => a.symbol),
      keyLevels: day.keyLevels,
      riskBudgetPercent: day.riskBudgetPercent ? day.riskBudgetPercent.toNumber() : null,
    },
    analytics,
  };
}

// Backs the calendar's "has a note" dot indicator. Returns every date key
// with a non-empty note for the user rather than scoping per-month, since
// the dataset is small and this avoids a round-trip on every month change.
export async function listNoteDateKeys(userId: string): Promise<string[]> {
  const notes = await prisma.dailyNote.findMany({
    where: { userId },
    select: { date: true },
  });
  return notes.map((n) => utcDateToKey(n.date));
}
