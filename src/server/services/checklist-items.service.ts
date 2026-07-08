import { prisma } from "@/server/db";
import type { ChecklistItemInput } from "@/lib/validation/trading-plan";
import type { ChecklistType } from "@prisma/client";

export async function listChecklistItems(userId: string, type: ChecklistType) {
  return prisma.checklistItemDefinition.findMany({
    where: { userId, type },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createChecklistItem(userId: string, data: ChecklistItemInput) {
  const last = await prisma.checklistItemDefinition.findFirst({
    where: { userId, type: data.type },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.checklistItemDefinition.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateChecklistItem(
  userId: string,
  id: string,
  data: ChecklistItemInput,
) {
  return prisma.checklistItemDefinition.update({
    where: { id, userId },
    data,
  });
}

export async function archiveChecklistItem(userId: string, id: string) {
  return prisma.checklistItemDefinition.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderChecklistItems(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.checklistItemDefinition.update({
        where: { id, userId },
        data: { sortOrder: index },
      }),
    ),
  );
}
