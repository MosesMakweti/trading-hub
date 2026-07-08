import { prisma } from "@/server/db";
import type { EntryModelInput } from "@/lib/validation/trading-plan";

export async function listEntryModels(userId: string) {
  return prisma.entryModel.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createEntryModel(userId: string, data: EntryModelInput) {
  const last = await prisma.entryModel.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.entryModel.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateEntryModel(userId: string, id: string, data: EntryModelInput) {
  return prisma.entryModel.update({
    where: { id, userId },
    data,
  });
}

export async function archiveEntryModel(userId: string, id: string) {
  return prisma.entryModel.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderEntryModels(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.entryModel.update({
        where: { id, userId },
        data: { sortOrder: index },
      }),
    ),
  );
}
