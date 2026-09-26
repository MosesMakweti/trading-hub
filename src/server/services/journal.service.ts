import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { getTradingDay } from "@/server/services/trading-day.service";
import { getDailyAnalytics } from "@/server/services/analytics.service";
import { routineProgress, type RoutineSnapshot } from "@/domain/today/routine-snapshot";
import type { DailyNoteInput } from "@/lib/validation/journal";
import type { JournalDayRecapDTO } from "@/types/today";

export async function getDailyNote(userId: string, dateKey: string) {
  return prisma.dailyNote.findFirst({
    where: { userId, date: dateKeyToUtcDate(dateKey) },
  });
}

/**
 * Ensures a DailyNote row exists for the day and returns it — used where we need a
 * stable id to hang media off (the day's image gallery). The row may be
 * content-less; `listNoteDateKeys` ignores content-less notes so this never
 * creates a false "has a note" calendar dot.
 */
export async function getOrCreateDailyNote(userId: string, dateKey: string) {
  const date = dateKeyToUtcDate(dateKey);
  return retryOnUniqueRace(() =>
    prisma.dailyNote.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date },
      update: {},
    }),
  );
}

export async function upsertDailyNote(userId: string, dateKey: string, data: DailyNoteInput) {
  const date = dateKeyToUtcDate(dateKey);
  const content = (data.content ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  return retryOnUniqueRace(() =>
    prisma.dailyNote.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, content },
      update: { content },
    }),
  );
}

/** Backtesting V1: DailyNote is environment-scoped (live note vs a run's note
 *  for the same date). The scope filter makes Prisma run these upserts as
 *  find-then-create, so a concurrent create can lose on the (partial) unique
 *  index — retried once, like getOrCreateTradingDay. */
async function retryOnUniqueRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fn();
    throw e;
  }
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

  const analytics = await getDailyAnalytics(userId, dateKey);

  const snapshot = (day.routineSnapshot as unknown as RoutineSnapshot | null) ?? null;

  return {
    status: day.status,
    prepDone: day.prepCompletedAt != null,
    planDone: day.planCompletedAt != null,
    analyzeDone: day.analyzedAt != null,
    routine: {
      snapshot,
      readyAt: day.routineReadyAt?.toISOString() ?? null,
      progress: snapshot
        ? routineProgress(snapshot)
        : { completed: 0, total: 0, percent: 0 },
    },
    plan: {
      bias: (day.bias as JournalDayRecapDTO["plan"]["bias"]) ?? null,
      conviction: day.conviction,
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
    // Content-less rows (auto-created only to anchor a day's image gallery) don't
    // count as "has a note" — only rows with actual note content get a dot.
    where: { userId, content: { not: Prisma.DbNull } },
    select: { date: true },
  });
  return notes.map((n) => utcDateToKey(n.date));
}
