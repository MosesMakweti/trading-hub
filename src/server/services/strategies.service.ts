import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type {
  StrategyCreateInput,
  StrategySettingsInput,
} from "@/lib/validation/strategies";

// Everything here is scoped by `userId` (tenant isolation) and the soft-delete
// extension in server/db.ts auto-filters `deletedAt: null` on find/list/count.

// When re-inserting a nullable Json column, a stored SQL NULL reads back as
// `null` but must be written as `Prisma.DbNull` (not the literal `null`).
function toJsonInput(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export async function listStrategies(userId: string) {
  return prisma.strategy.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getStrategy(userId: string, id: string) {
  // findFirst so the soft-delete filter applies (findUnique bypasses it).
  return prisma.strategy.findFirst({ where: { id, userId } });
}

export async function createStrategy(userId: string, data: StrategyCreateInput) {
  const last = await prisma.strategy.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.strategy.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

/** Settings-tab update (name, description, assets, status). Autosaved. */
export async function updateStrategySettings(
  userId: string,
  id: string,
  data: StrategySettingsInput,
) {
  // Scope the write by userId via updateMany (update-by-unique-id can't also
  // filter userId), so a user can never edit another tenant's strategy.
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: {
      name: data.name,
      description: data.description ?? null,
      applicableAssets: data.applicableAssets,
      status: data.status,
    },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

export async function renameStrategy(userId: string, id: string, name: string) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { name },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/** Archive is a status, not a delete — the strategy stays fully editable. */
export async function setStrategyStatus(
  userId: string,
  id: string,
  status: StrategySettingsInput["status"],
) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { status },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/** Delete = soft delete (hidden by the db.ts extension), reversible at the DB level. */
export async function deleteStrategy(userId: string, id: string) {
  const result = await prisma.strategy.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Strategy not found.");
}

/**
 * Deep-copy a strategy, including (eventually) every nested workspace section.
 *
 * Phase 1 only copies the top-level fields. It is written as a single
 * transaction on purpose: when Phase 2+ adds nested sections (Arsenal concepts,
 * framework steps, timeframes + checkpoints, entry models, trade management),
 * their rows are created inside THIS transaction keyed to `copy.id` — see the
 * marked extension point below — so a duplicate is always all-or-nothing.
 */
export async function duplicateStrategy(userId: string, id: string) {
  const source = await prisma.strategy.findFirst({
    where: { id, userId },
    include: {
      // Only live rows; the extension doesn't filter nested relations.
      arsenalConcepts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!source) throw new Error("Strategy not found.");

  const last = await prisma.strategy.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.$transaction(async (tx) => {
    const copy = await tx.strategy.create({
      data: {
        userId,
        name: `${source.name} (copy)`,
        description: source.description,
        applicableAssets: source.applicableAssets,
        // A duplicate starts as a working draft you then adapt.
        status: "DRAFT",
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    // ── Deep-copy nested sections into `copy` (add future sections here) ─────
    // Section 1 — Arsenal:
    if (source.arsenalConcepts.length > 0) {
      await tx.arsenalConcept.createMany({
        data: source.arsenalConcepts.map((c) => ({
          strategyId: copy.id,
          name: c.name,
          sortOrder: c.sortOrder,
          definition: toJsonInput(c.definition),
          purpose: toJsonInput(c.purpose),
          howIIdentify: toJsonInput(c.howIIdentify),
          whyItMatters: toJsonInput(c.whyItMatters),
          whenIUse: toJsonInput(c.whenIUse),
          whenIIgnore: toJsonInput(c.whenIIgnore),
          examples: toJsonInput(c.examples),
          personalNotes: toJsonInput(c.personalNotes),
        })),
      });
    }

    return copy;
  });
}

/** Ready for drag-and-drop reordering of the strategy list (Phase 2 UI). */
export async function reorderStrategies(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.strategy.updateMany({
        where: { id, userId },
        data: { sortOrder: index } as Prisma.StrategyUpdateManyMutationInput,
      }),
    ),
  );
}
