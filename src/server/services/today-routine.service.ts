import { Prisma, type TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDefaultRoutine } from "@/server/services/routine.service";
import {
  allMandatoryComplete,
  type RoutineResponse,
  type RoutineSnapshot,
  type RoutineSnapshotSection,
} from "@/domain/today/routine-snapshot";

/** Thrown when the "ready to trade" gate is attempted with mandatory items unmet. */
export class RoutineGateError extends Error {}

export interface DayRoutine {
  snapshot: RoutineSnapshot;
  readyAt: string | null;
}

/** The live template, projected into the snapshot's structure shape. */
function sectionsFromTemplate(
  template: Awaited<ReturnType<typeof getOrCreateDefaultRoutine>>,
): RoutineSnapshotSection[] {
  return template.map((s) => ({
    id: s.id,
    title: s.title,
    items: s.items.map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      isMandatory: i.isMandatory,
    })),
  }));
}

/**
 * The day's routine. The **template** (RoutineSection/RoutineItem, edited in
 * Settings) is the single source of truth for the routine's structure:
 *
 * - **Editable (ACTIVE) day** — the structure is always rebuilt from the live
 *   template, so edits made in Settings (add/remove/rename/reorder/retype items)
 *   show up on Today immediately, while the trader's responses (keyed by item id)
 *   are carried over. The per-day JSON is a derived cache, not an independent copy.
 * - **ARCHIVED day** — immutable journal history: the frozen snapshot is returned
 *   verbatim, so a past day always shows the exact routine run that day.
 *
 * Seeds the default template on first use. Takes an already-created `day` (rather
 * than upserting) so the caller creates the TradingDay once — upserting here in
 * parallel raced on the (userId, date) unique constraint.
 */
export async function getOrCreateDayRoutine(userId: string, day: TradingDay): Promise<DayRoutine> {
  const stored = (day.routineSnapshot as unknown as RoutineSnapshot | null) ?? null;
  const readyAt = day.routineReadyAt?.toISOString() ?? null;

  // Archived days are immutable history — never re-read the mutable template.
  if (day.status === "ARCHIVED" && stored) {
    return { snapshot: stored, readyAt };
  }

  const template = await getOrCreateDefaultRoutine(userId);
  const sections = sectionsFromTemplate(template);
  const snapshot: RoutineSnapshot = { sections, responses: stored?.responses ?? {} };

  // Persist only when the structure actually changed, so a normal page load isn't
  // a write (and doesn't churn the cache) — but a Settings edit is picked up here.
  if (!stored || JSON.stringify(stored.sections) !== JSON.stringify(sections)) {
    await prisma.tradingDay.update({
      where: { id: day.id },
      data: { routineSnapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
  }

  return { snapshot, readyAt };
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
 *
 * The gate is enforced HERE, server-side: readiness can only be set when every
 * MANDATORY routine item is complete. Because the whole downstream workflow (Today's
 * Plan, Trade Ideas, …) is gated on routineReadyAt, guarding this write means the
 * requirement can't be bypassed by the client (direct navigation, refresh, URL
 * manipulation) — the state that unlocks Today's Plan is unreachable otherwise.
 */
export async function setRoutineReady(userId: string, dateKey: string, ready: boolean): Promise<void> {
  const day = await getOrCreateTradingDay(userId, dateKey);

  if (ready) {
    const snapshot = (day.routineSnapshot as unknown as RoutineSnapshot | null) ?? null;
    if (!snapshot || !allMandatoryComplete(snapshot)) {
      throw new RoutineGateError("Complete every required routine item before continuing.");
    }
  }

  const now = ready ? new Date() : null;
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: { routineReadyAt: now, prepCompletedAt: now },
  });
}
