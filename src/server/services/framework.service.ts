import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { FRAMEWORK_RICH_FIELDS, type FrameworkStepUpdateInput } from "@/lib/validation/framework";

// Scoped to the user THROUGH the parent Strategy (steps carry no userId).
// updateMany / nested relation filters spell out `deletedAt: null` explicitly
// because the soft-delete extension only covers find/list/count on top-level models.

const ownedStep = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  strategy: { userId, deletedAt: null },
});

export async function listFrameworkSteps(userId: string, strategyId: string) {
  return prisma.strategyFrameworkStep.findMany({
    where: { strategyId, strategy: { userId, deletedAt: null } },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createFrameworkStep(userId: string, strategyId: string, title: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new Error("Strategy not found.");

  const last = await prisma.strategyFrameworkStep.findFirst({
    where: { strategyId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategyFrameworkStep.create({
    data: { strategyId, title, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateFrameworkStep(
  userId: string,
  id: string,
  data: FrameworkStepUpdateInput,
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  for (const key of FRAMEWORK_RICH_FIELDS) {
    const value = data[key];
    if (value !== undefined) patch[key] = value === null ? Prisma.DbNull : value;
  }

  const result = await prisma.strategyFrameworkStep.updateMany({
    where: ownedStep(userId, id),
    data: patch as Prisma.StrategyFrameworkStepUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Step not found.");
}

export async function archiveFrameworkStep(userId: string, id: string) {
  const result = await prisma.strategyFrameworkStep.updateMany({
    where: ownedStep(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Step not found.");
}

export async function reorderFrameworkSteps(
  userId: string,
  strategyId: string,
  orderedIds: string[],
) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategyFrameworkStep.updateMany({
        where: { id, strategyId, strategy: { userId } },
        data: { sortOrder: index },
      }),
    ),
  );
}
