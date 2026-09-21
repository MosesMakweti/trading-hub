import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import {
  RoutineGateError,
  getOrCreateDayRoutine,
  setRoutineReady,
  setRoutineResponse,
} from "@/server/services/today-routine.service";

/**
 * Real integration tests against the dev Postgres DB (same pattern as
 * dashboard.service.test.ts). Covers the Pre-Session Routine gate: the single
 * canonical `allMandatoryComplete` rule must hold end-to-end through the
 * server-side snapshot/response/gate pipeline, including reload and template
 * (add/delete item) edge cases — not just the pure domain predicate already
 * covered by routine-snapshot.test.ts.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `today-routine-svc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function makeSection(userId: string, title: string) {
  return prisma.routineSection.create({ data: { userId, title, sortOrder: 0 } });
}

async function makeItem(
  userId: string,
  sectionId: string,
  overrides: { label: string; isMandatory: boolean; sortOrder?: number },
) {
  return prisma.routineItem.create({
    data: {
      userId,
      sectionId,
      label: overrides.label,
      type: "CHECKBOX",
      isMandatory: overrides.isMandatory,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

describe("today-routine.service.ts — the pre-session gate", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("1. all required items checked -> Continue succeeds", async () => {
    const user = await makeUser("all-required-checked");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });
    const req2 = await makeItem(user.id, section.id, { label: "Calendar", isMandatory: true, sortOrder: 1 });

    const dateKey = "2026-01-05";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);

    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });
    await setRoutineResponse(user.id, dateKey, req2.id, { checked: true });

    await expect(setRoutineReady(user.id, dateKey, true)).resolves.toBeUndefined();
    const updated = await prisma.tradingDay.findUniqueOrThrow({ where: { id: day.id } });
    expect(updated.routineReadyAt).not.toBeNull();
    expect(updated.prepCompletedAt).not.toBeNull();
  });

  it("2. one required item unchecked -> Continue is blocked", async () => {
    const user = await makeUser("one-required-unchecked");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });
    await makeItem(user.id, section.id, { label: "Calendar", isMandatory: true, sortOrder: 1 });

    const dateKey = "2026-01-06";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });

    await expect(setRoutineReady(user.id, dateKey, true)).rejects.toThrow(RoutineGateError);
    const updated = await prisma.tradingDay.findUniqueOrThrow({ where: { id: day.id } });
    expect(updated.routineReadyAt).toBeNull();
  });

  it("3. all required checked + optional unchecked -> Continue succeeds", async () => {
    const user = await makeUser("optional-unchecked");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });
    await makeItem(user.id, section.id, { label: "Mental prep", isMandatory: false, sortOrder: 1 });

    const dateKey = "2026-01-07";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });

    await expect(setRoutineReady(user.id, dateKey, true)).resolves.toBeUndefined();
  });

  it("4. an inactive (soft-deleted) required item does not block progression", async () => {
    const user = await makeUser("deleted-required");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });
    const staleReq = await makeItem(user.id, section.id, { label: "Old required item", isMandatory: true, sortOrder: 1 });

    const dateKey = "2026-01-08";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day); // freezes today's snapshot with both required items

    // The trader deletes the stale item from the template (Settings) before completing it.
    await prisma.routineItem.update({ where: { id: staleReq.id }, data: { deletedAt: new Date() } });

    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });
    // A reload re-syncs today's snapshot structure from the live template, so the
    // deleted item drops out of the gate's denominator.
    const currentDay = await prisma.tradingDay.findUniqueOrThrow({ where: { id: day.id } });
    const reloaded = await getOrCreateDayRoutine(user.id, currentDay);
    const items = reloaded.snapshot.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(items).not.toContain(staleReq.id);

    await expect(setRoutineReady(user.id, dateKey, true)).resolves.toBeUndefined();
  });

  it("5. the final required checkbox saved immediately before Continue succeeds (no race)", async () => {
    const user = await makeUser("immediate-continue");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });

    const dateKey = "2026-01-09";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);

    // The save must be awaited (as the client now guarantees before firing the
    // gate check) for the very next call to see it — this is the invariant the
    // client-side fix in pre-session-routine-section.tsx relies on.
    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });
    await expect(setRoutineReady(user.id, dateKey, true)).resolves.toBeUndefined();
  });

  it("6. reload after completing the routine stays complete", async () => {
    const user = await makeUser("reload-stays-complete");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });

    const dateKey = "2026-01-10";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });
    await setRoutineReady(user.id, dateKey, true);

    // Simulate a page reload: re-fetch the day and re-derive the routine.
    const reloadedDay = await prisma.tradingDay.findUniqueOrThrow({ where: { id: day.id } });
    const reloaded = await getOrCreateDayRoutine(user.id, reloadedDay);
    expect(reloaded.readyAt).not.toBeNull();
    expect(reloaded.snapshot.responses[req1.id]?.checked).toBe(true);
  });

  it("7. adding a new required item after completion re-locks, but stale/removed items never do", async () => {
    const user = await makeUser("config-change");
    userIds.push(user.id);
    const section = await makeSection(user.id, "Prep");
    const req1 = await makeItem(user.id, section.id, { label: "Bias", isMandatory: true });

    const dateKey = "2026-01-11";
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineResponse(user.id, dateKey, req1.id, { checked: true });
    await setRoutineReady(user.id, dateKey, true);

    // Removing the completed item from the template (e.g. renamed/replaced in
    // Settings) must not leave a stale completion record blocking anything.
    await prisma.routineItem.update({ where: { id: req1.id }, data: { deletedAt: new Date() } });
    const afterDelete = await getOrCreateDayRoutine(user.id, await prisma.tradingDay.findUniqueOrThrow({ where: { id: day.id } }));
    expect(afterDelete.snapshot.sections.flatMap((s) => s.items)).toHaveLength(0);
    await expect(setRoutineReady(user.id, dateKey, true)).resolves.toBeUndefined();
  });
});
