import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { ARSENAL_RICH_FIELDS, type ArsenalConceptUpdateInput } from "@/lib/validation/arsenal";

// ArsenalConcept has no userId of its own — every query is scoped to the user
// THROUGH its parent Strategy (`strategy: { userId, deletedAt: null }`). The
// soft-delete extension in server/db.ts auto-filters ArsenalConcept.deletedAt on
// find/list/count, but NOT on updateMany or on nested relation filters, so those
// spell out `deletedAt: null` explicitly.

const ownedConcept = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  strategy: { userId, deletedAt: null },
});

export async function listArsenalConcepts(userId: string, strategyId: string) {
  return prisma.arsenalConcept.findMany({
    where: { strategyId, strategy: { userId, deletedAt: null } },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createArsenalConcept(userId: string, strategyId: string, name: string) {
  // Verify the parent strategy is owned & live before attaching a concept.
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new Error("Strategy not found.");

  const last = await prisma.arsenalConcept.findFirst({
    where: { strategyId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.arsenalConcept.create({
    data: { strategyId, name, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateArsenalConcept(
  userId: string,
  id: string,
  data: ArsenalConceptUpdateInput,
) {
  // Build a Prisma-typed patch from the validated partial: only include keys
  // that were actually provided, and map a cleared rich field (null) to DbNull.
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  for (const key of ARSENAL_RICH_FIELDS) {
    const value = data[key];
    if (value !== undefined) patch[key] = value === null ? Prisma.DbNull : value;
  }

  const result = await prisma.arsenalConcept.updateMany({
    where: ownedConcept(userId, id),
    data: patch as Prisma.ArsenalConceptUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Concept not found.");
}

export async function archiveArsenalConcept(userId: string, id: string) {
  const result = await prisma.arsenalConcept.updateMany({
    where: ownedConcept(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Concept not found.");
}

export async function reorderArsenalConcepts(
  userId: string,
  strategyId: string,
  orderedIds: string[],
) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.arsenalConcept.updateMany({
        where: { id, strategyId, strategy: { userId } },
        data: { sortOrder: index },
      }),
    ),
  );
}
