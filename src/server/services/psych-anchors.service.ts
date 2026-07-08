import { prisma } from "@/server/db";
import type { PsychAnchorInput } from "@/lib/validation/trading-plan";

export async function listPsychAnchors(userId: string) {
  return prisma.psychologicalAnchor.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createPsychAnchor(userId: string, data: PsychAnchorInput) {
  const last = await prisma.psychologicalAnchor.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.psychologicalAnchor.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updatePsychAnchor(userId: string, id: string, data: PsychAnchorInput) {
  return prisma.psychologicalAnchor.update({
    where: { id, userId },
    data,
  });
}

export async function archivePsychAnchor(userId: string, id: string) {
  return prisma.psychologicalAnchor.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderPsychAnchors(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.psychologicalAnchor.update({
        where: { id, userId },
        data: { sortOrder: index },
      }),
    ),
  );
}
