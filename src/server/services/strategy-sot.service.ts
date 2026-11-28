import { prisma } from "@/server/db";
import { isEligibleForScenario } from "@/domain/strategies/setup-type-scoring";
import { scenarioDirectionLabel } from "@/domain/strategies/scenario-playbook";
import { StrategyLabError } from "@/server/services/strategy-errors";
import type {
  StrategyChecklistItemInput,
  StrategyChecklistKindValue,
  StrategySessionInput,
} from "@/lib/validation/strategy-sot";

/**
 * The user's session windows for the dashboard countdown — sourced from all of
 * their strategies' enabled sessions that have a start+end time, deduped by name
 * (the same session, e.g. "NY AM", can appear across strategies). Sessions live
 * inside strategies now (SOT); there is no global session list.
 */
export async function listStrategySessionWindows(userId: string) {
  const rows = await prisma.strategySession.findMany({
    where: { userId, enabled: true, startMinutes: { not: null }, endMinutes: { not: null } },
    orderBy: { startMinutes: "asc" },
    select: { id: true, name: true, startMinutes: true, endMinutes: true },
  });

  const seen = new Set<string>();
  const windows: { id: string; name: string; startMinutes: number; endMinutes: number }[] = [];
  for (const r of rows) {
    if (r.startMinutes == null || r.endMinutes == null) continue;
    const key = r.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({ id: r.id, name: r.name, startMinutes: r.startMinutes, endMinutes: r.endMinutes });
  }
  return windows;
}

async function assertOwnsStrategy(userId: string, strategyId: string) {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!strategy) throw new StrategyLabError("Strategy not found.", "NOT_FOUND");
}

// Live, owned rows only. These models aren't covered by the soft-delete
// extension, so `deletedAt: null` is explicit; the parent strategy must be
// live too, so a deleted strategy's items can't be edited through a stale tab.
const ownedLive = (userId: string, id: string) => ({
  id,
  userId,
  deletedAt: null,
  strategy: { deletedAt: null },
});

// ── Checklist items (confluences + execution confirmations) ──────────────────

export async function listStrategyChecklist(
  userId: string,
  strategyId: string,
  kind: StrategyChecklistKindValue,
) {
  return prisma.strategyChecklistItem.findMany({
    where: { userId, strategyId, kind, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createChecklistItem(
  userId: string,
  strategyId: string,
  kind: StrategyChecklistKindValue,
  data: StrategyChecklistItemInput,
) {
  await assertOwnsStrategy(userId, strategyId);
  const last = await prisma.strategyChecklistItem.findFirst({
    where: { userId, strategyId, kind, deletedAt: null },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.strategyChecklistItem.create({
    data: {
      userId,
      strategyId,
      kind,
      name: data.name,
      color: data.color,
      category: data.category ?? null,
      description: data.description ?? null,
      weight: data.weight ?? null,
      mandatory: data.mandatory,
      // Direction applies to confluences only; execution confirmations stay BOTH.
      directionApplicability: kind === "CONFLUENCE" ? data.directionApplicability : "BOTH",
      pairId: kind === "CONFLUENCE" ? data.pairId ?? null : null,
      validationCriteria: data.validationCriteria ?? null,
      enabled: data.enabled,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

/**
 * Edits a checklist item. A direction change is refused while the item is a
 * condition of a live setup-type scenario that the new direction can't serve
 * (e.g. making a confluence BEARISH-only while a Bullish scenario still
 * scores it on LONG trades) — the same rule addScenarioCondition and
 * updateScenarioDetails already enforce.
 */
export async function updateChecklistItem(
  userId: string,
  id: string,
  data: StrategyChecklistItemInput,
) {
  const existing = await prisma.strategyChecklistItem.findFirst({
    where: ownedLive(userId, id),
    select: { kind: true, directionApplicability: true },
  });
  if (!existing) throw new StrategyLabError("That item no longer exists. Refresh and try again.", "NOT_FOUND");
  const isConfluence = existing.kind === "CONFLUENCE";
  const nextDirection = isConfluence ? data.directionApplicability : "BOTH";

  if (nextDirection !== existing.directionApplicability) {
    const usages = await prisma.strategySetupScenarioCondition.findMany({
      where: { checklistItemId: id, scenario: { deletedAt: null, setupType: { deletedAt: null } } },
      select: { scenario: { select: { name: true, direction: true, setupType: { select: { name: true } } } } },
    });
    const blocking = usages.filter((u) => !isEligibleForScenario(nextDirection, u.scenario.direction));
    if (blocking.length > 0) {
      const where = blocking
        .map((u) => `${u.scenario.setupType.name} › ${u.scenario.name || scenarioDirectionLabel(u.scenario.direction)}`)
        .join(", ");
      throw new StrategyLabError(
        `This confluence is used in ${where}. Remove it there first — a ${nextDirection.toLowerCase()}-only confluence can't be scored in ${blocking.length === 1 ? "that scenario" : "those scenarios"}.`,
        "INVALID",
      );
    }
  }

  const result = await prisma.strategyChecklistItem.updateMany({
    where: ownedLive(userId, id),
    data: {
      name: data.name,
      color: data.color,
      category: data.category ?? null,
      description: data.description ?? null,
      weight: data.weight ?? null,
      mandatory: data.mandatory,
      // Edit direction in place — no delete/recreate needed. Execution items
      // are always BOTH.
      directionApplicability: nextDirection,
      pairId: isConfluence ? data.pairId ?? null : null,
      validationCriteria: data.validationCriteria ?? null,
      enabled: data.enabled,
    },
  });
  if (result.count === 0) throw new StrategyLabError("That item no longer exists. Refresh and try again.", "NOT_FOUND");
}

export async function deleteChecklistItem(userId: string, id: string) {
  const result = await prisma.strategyChecklistItem.updateMany({
    where: ownedLive(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new StrategyLabError("That item was already deleted. Refresh to update the list.", "NOT_FOUND");
}

export async function reorderChecklistItems(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyChecklistItem.updateMany({ where: { id, userId, deletedAt: null }, data: { sortOrder: index } }),
    ),
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function listStrategySessions(userId: string, strategyId: string) {
  return prisma.strategySession.findMany({
    where: { userId, strategyId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createStrategySession(
  userId: string,
  strategyId: string,
  data: StrategySessionInput,
) {
  await assertOwnsStrategy(userId, strategyId);
  const last = await prisma.strategySession.findFirst({
    where: { userId, strategyId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.strategySession.create({
    data: {
      userId,
      strategyId,
      name: data.name,
      color: data.color,
      startMinutes: data.startMinutes ?? null,
      endMinutes: data.endMinutes ?? null,
      enabled: data.enabled,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateStrategySession(
  userId: string,
  id: string,
  data: StrategySessionInput,
) {
  const result = await prisma.strategySession.updateMany({
    where: ownedLive(userId, id),
    data: {
      name: data.name,
      color: data.color,
      startMinutes: data.startMinutes ?? null,
      endMinutes: data.endMinutes ?? null,
      enabled: data.enabled,
    },
  });
  if (result.count === 0) throw new StrategyLabError("That session no longer exists. Refresh and try again.", "NOT_FOUND");
}

export async function deleteStrategySession(userId: string, id: string) {
  const result = await prisma.strategySession.updateMany({
    where: ownedLive(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new StrategyLabError("That session was already deleted. Refresh to update the list.", "NOT_FOUND");
}

export async function reorderStrategySessions(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategySession.updateMany({ where: { id, userId, deletedAt: null }, data: { sortOrder: index } }),
    ),
  );
}
