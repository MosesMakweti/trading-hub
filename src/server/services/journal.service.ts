import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import type { DailyNoteInput } from "@/lib/validation/journal";

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
