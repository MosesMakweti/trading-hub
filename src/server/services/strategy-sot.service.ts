import { prisma } from "@/server/db";
import type {
  StrategyChecklistItemInput,
  StrategyChecklistKindValue,
  StrategySessionInput,
} from "@/lib/validation/strategy-sot";

async function assertOwnsStrategy(userId: string, strategyId: string) {
  const strategy = await prisma.strategy.findFirst({
    where: { id: strategyId, userId },
    select: { id: true },
  });
  if (!strategy) throw new Error("Strategy not found.");
}

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
      enabled: data.enabled,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateChecklistItem(
  userId: string,
  id: string,
  data: StrategyChecklistItemInput,
) {
  return prisma.strategyChecklistItem.update({
    where: { id, userId },
    data: {
      name: data.name,
      color: data.color,
      category: data.category ?? null,
      description: data.description ?? null,
      weight: data.weight ?? null,
      enabled: data.enabled,
    },
  });
}

export async function deleteChecklistItem(userId: string, id: string) {
  return prisma.strategyChecklistItem.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderChecklistItems(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyChecklistItem.update({ where: { id, userId }, data: { sortOrder: index } }),
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
  return prisma.strategySession.update({
    where: { id, userId },
    data: {
      name: data.name,
      color: data.color,
      startMinutes: data.startMinutes ?? null,
      endMinutes: data.endMinutes ?? null,
      enabled: data.enabled,
    },
  });
}

export async function deleteStrategySession(userId: string, id: string) {
  return prisma.strategySession.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderStrategySessions(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategySession.update({ where: { id, userId }, data: { sortOrder: index } }),
    ),
  );
}
