import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { CHECKPOINT_RICH_FIELDS, type CheckpointUpdateInput } from "@/lib/validation/timeframes";

// Two-level section. Timeframes scope to the user via their Strategy; checkpoints
// via their timeframe's strategy. updateMany / nested relation filters spell out
// `deletedAt: null` explicitly (the soft-delete extension only covers find/list/count).

const ownedTimeframe = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  strategy: { userId, deletedAt: null },
});

const ownedCheckpoint = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  timeframe: { deletedAt: null, strategy: { userId, deletedAt: null } },
});

// ── Timeframes ───────────────────────────────────────────────────────────────
export async function listTimeframes(userId: string, strategyId: string) {
  return prisma.strategyTimeframe.findMany({
    where: { strategyId, strategy: { userId, deletedAt: null } },
    orderBy: { sortOrder: "asc" },
    include: {
      // Nested — not covered by the extension, so filter/sort explicitly.
      checkpoints: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function createTimeframe(userId: string, strategyId: string, name: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new Error("Strategy not found.");

  const last = await prisma.strategyTimeframe.findFirst({
    where: { strategyId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategyTimeframe.create({
    data: { strategyId, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function renameTimeframe(userId: string, id: string, name: string) {
  const result = await prisma.strategyTimeframe.updateMany({
    where: ownedTimeframe(userId, id),
    data: { name },
  });
  if (result.count === 0) throw new Error("Timeframe not found.");
}

export async function archiveTimeframe(userId: string, id: string) {
  const result = await prisma.strategyTimeframe.updateMany({
    where: ownedTimeframe(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Timeframe not found.");
}

export async function reorderTimeframes(userId: string, strategyId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyTimeframe.updateMany({
        where: { id, strategyId, strategy: { userId } },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
export async function createCheckpoint(userId: string, timeframeId: string, title: string) {
  const timeframe = await prisma.strategyTimeframe.findFirst({
    where: { id: timeframeId, strategy: { userId } },
  });
  if (!timeframe) throw new Error("Timeframe not found.");

  const last = await prisma.strategyCheckpoint.findFirst({
    where: { timeframeId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategyCheckpoint.create({
    data: { timeframeId, title, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateCheckpoint(userId: string, id: string, data: CheckpointUpdateInput) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  for (const key of CHECKPOINT_RICH_FIELDS) {
    const value = data[key];
    if (value !== undefined) patch[key] = value === null ? Prisma.DbNull : value;
  }

  const result = await prisma.strategyCheckpoint.updateMany({
    where: ownedCheckpoint(userId, id),
    data: patch as Prisma.StrategyCheckpointUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Checkpoint not found.");
}

export async function archiveCheckpoint(userId: string, id: string) {
  const result = await prisma.strategyCheckpoint.updateMany({
    where: ownedCheckpoint(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Checkpoint not found.");
}

export async function reorderCheckpoints(userId: string, timeframeId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyCheckpoint.updateMany({
        where: { id, timeframeId, timeframe: { strategy: { userId } } },
        data: { sortOrder: index },
      }),
    ),
  );
}
