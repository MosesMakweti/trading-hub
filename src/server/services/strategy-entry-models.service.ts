import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import {
  ENTRY_MODEL_RICH_FIELDS,
  type EntryModelUpdateInput,
} from "@/lib/validation/strategy-entry-models";
import type { PatternDTO } from "@/types/strategies";

// Scoped to the user THROUGH the parent Strategy (entry models carry no userId).
// updateMany / nested relation filters spell out `deletedAt: null` explicitly.

const ownedModel = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  strategy: { userId, deletedAt: null },
});

export async function listEntryModels(userId: string, strategyId: string) {
  return prisma.strategyEntryModel.findMany({
    where: { strategyId, strategy: { userId, deletedAt: null } },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * The Pattern Library: every entry model across all of the user's (non-deleted)
 * strategies, flattened into one catalog of setups with plain-text previews and
 * a link back to the owning strategy. Scoped through the parent Strategy since
 * entry models carry no userId.
 */
export async function listEntryModelPatterns(userId: string): Promise<PatternDTO[]> {
  const models = await prisma.strategyEntryModel.findMany({
    where: { strategy: { userId, deletedAt: null } },
    orderBy: [{ strategy: { name: "asc" } }, { sortOrder: "asc" }],
    include: { strategy: { select: { id: true, name: true, status: true } } },
  });

  return models.map((m) => ({
    id: m.id,
    name: m.name,
    strategyId: m.strategy.id,
    strategyName: m.strategy.name,
    strategyStatus: m.strategy.status,
    descriptionPreview: tiptapToPlainText(m.description),
    conditionsPreview: tiptapToPlainText(m.conditions),
  }));
}

export async function createEntryModel(userId: string, strategyId: string, name: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new Error("Strategy not found.");

  const last = await prisma.strategyEntryModel.findFirst({
    where: { strategyId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategyEntryModel.create({
    data: { strategyId, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateEntryModel(userId: string, id: string, data: EntryModelUpdateInput) {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  for (const key of ENTRY_MODEL_RICH_FIELDS) {
    const value = data[key];
    if (value !== undefined) patch[key] = value === null ? Prisma.DbNull : value;
  }

  const result = await prisma.strategyEntryModel.updateMany({
    where: ownedModel(userId, id),
    data: patch as Prisma.StrategyEntryModelUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Entry model not found.");
}

export async function archiveEntryModel(userId: string, id: string) {
  const result = await prisma.strategyEntryModel.updateMany({
    where: ownedModel(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Entry model not found.");
}

export async function reorderEntryModels(userId: string, strategyId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyEntryModel.updateMany({
        where: { id, strategyId, strategy: { userId } },
        data: { sortOrder: index },
      }),
    ),
  );
}
