import { prisma } from "@/server/db";
import { DEFAULT_ROUTINE } from "@/domain/today/default-routine";
import type {
  RoutineItemInput,
  RoutineItemUpdateInput,
  RoutineSectionInput,
} from "@/lib/validation/routine";

/**
 * Sections (ordered) with their non-deleted items (ordered). The soft-delete
 * extension filters `deletedAt: null` on the top-level sections automatically,
 * but NOT on the nested `items` include — so that filter is spelled out here.
 */
export async function listRoutine(userId: string) {
  return prisma.routineSection.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    include: {
      items: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });
}

/**
 * Lazily seed the default routine the first time a user opens it (no sections
 * yet), mirroring the get-or-create pattern used for the Performance Account.
 * Note: if a user deletes every section the default is re-seeded on next load —
 * an acceptable "always have a starting ritual" behavior.
 */
export async function getOrCreateDefaultRoutine(userId: string) {
  const existing = await prisma.routineSection.count({ where: { userId } });
  if (existing === 0) {
    await prisma.$transaction(async (tx) => {
      for (let s = 0; s < DEFAULT_ROUTINE.length; s++) {
        const section = DEFAULT_ROUTINE[s];
        const created = await tx.routineSection.create({
          data: { userId, title: section.title, sortOrder: s },
        });
        await tx.routineItem.createMany({
          data: section.items.map((item, i) => ({
            userId,
            sectionId: created.id,
            label: item.label,
            type: item.type,
            isMandatory: item.isMandatory ?? false,
            sortOrder: i,
          })),
        });
      }
    });
  }
  return listRoutine(userId);
}

// ---- Sections ------------------------------------------------------------

export async function createSection(userId: string, data: RoutineSectionInput) {
  const last = await prisma.routineSection.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.routineSection.create({
    data: { userId, title: data.title, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function renameSection(userId: string, id: string, data: RoutineSectionInput) {
  return prisma.routineSection.update({ where: { id, userId }, data: { title: data.title } });
}

export async function setSectionCollapsed(userId: string, id: string, collapsed: boolean) {
  return prisma.routineSection.update({ where: { id, userId }, data: { collapsed } });
}

export async function deleteSection(userId: string, id: string) {
  // Soft-delete the section and its items together.
  const now = new Date();
  await prisma.$transaction([
    prisma.routineItem.updateMany({ where: { sectionId: id, userId }, data: { deletedAt: now } }),
    prisma.routineSection.update({ where: { id, userId }, data: { deletedAt: now } }),
  ]);
}

export async function reorderSections(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.routineSection.update({ where: { id, userId }, data: { sortOrder: index } }),
    ),
  );
}

// ---- Items ---------------------------------------------------------------

export async function createItem(userId: string, data: RoutineItemInput) {
  // Guard: the section must belong to the user.
  const section = await prisma.routineSection.findFirst({
    where: { id: data.sectionId, userId },
    select: { id: true },
  });
  if (!section) throw new Error("Section not found.");

  const last = await prisma.routineItem.findFirst({
    where: { userId, sectionId: data.sectionId },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.routineItem.create({
    data: {
      userId,
      sectionId: data.sectionId,
      label: data.label,
      type: data.type,
      isMandatory: data.isMandatory,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

export async function updateItem(userId: string, id: string, data: RoutineItemUpdateInput) {
  return prisma.routineItem.update({
    where: { id, userId },
    data: { label: data.label, type: data.type, isMandatory: data.isMandatory },
  });
}

export async function deleteItem(userId: string, id: string) {
  return prisma.routineItem.update({ where: { id, userId }, data: { deletedAt: new Date() } });
}

export async function reorderItems(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.routineItem.update({ where: { id, userId }, data: { sortOrder: index } }),
    ),
  );
}
