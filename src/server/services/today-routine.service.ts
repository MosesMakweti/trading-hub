import { Prisma, type TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDefaultRoutine } from "@/server/services/routine.service";
import type { RoutineResponse, RoutineSnapshot } from "@/domain/today/routine-snapshot";

export interface DayRoutine {
  snapshot: RoutineSnapshot;
  readyAt: string | null;
}

/**
 * The day's routine. Freezes a snapshot of the current template the first time the
 * day is opened (seeding the default template if the user has none), then always
 * returns that frozen copy — template edits afterwards never change this day.
 *
 * Takes an already-created `day` (rather than upserting it) so the caller can
 * create the TradingDay once — upserting it here in parallel with the caller's own
 * get-or-create raced on the (userId, date) unique constraint.
 */
export async function getOrCreateDayRoutine(userId: string, day: TradingDay): Promise<DayRoutine> {
  if (day.routineSnapshot) {
    return {
      snapshot: day.routineSnapshot as unknown as RoutineSnapshot,
      readyAt: day.routineReadyAt?.toISOString() ?? null,
    };
  }

  const template = await getOrCreateDefaultRoutine(userId);
  const snapshot: RoutineSnapshot = {
    sections: template.map((s) => ({
      id: s.id,
      title: s.title,
      items: s.items.map((i) => ({ id: i.id, label: i.label, type: i.type })),
    })),
    responses: {},
  };

  await prisma.tradingDay.update({
    where: { id: day.id },
    data: { routineSnapshot: snapshot as unknown as Prisma.InputJsonValue },
  });

  return { snapshot, readyAt: day.routineReadyAt?.toISOString() ?? null };
}

/** Merge a single item's response into the day's snapshot (structure untouched). */
export async function setRoutineResponse(
  userId: string,
  dateKey: string,
  itemId: string,
  response: RoutineResponse,
): Promise<void> {
  const day = await getTradingDay(userId, dateKey);
  if (!day?.routineSnapshot) throw new Error("No routine for this day.");

  const snapshot = day.routineSnapshot as unknown as RoutineSnapshot;
  const exists = snapshot.sections.some((s) => s.items.some((i) => i.id === itemId));
  if (!exists) throw new Error("Unknown routine item.");

  snapshot.responses = {
    ...snapshot.responses,
    [itemId]: { ...snapshot.responses[itemId], ...response },
  };

  await prisma.tradingDay.update({
    where: { id: day.id },
    data: { routineSnapshot: snapshot as unknown as Prisma.InputJsonValue },
  });
}

/**
 * The "I am ready to trade" gate. Sets routineReadyAt (and prepCompletedAt, which
 * advances the workflow's `prep` step / unlocks the rest of Today). Un-readying
 * clears both.
 */
export async function setRoutineReady(userId: string, dateKey: string, ready: boolean): Promise<void> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  const now = ready ? new Date() : null;
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: { routineReadyAt: now, prepCompletedAt: now },
  });
}
