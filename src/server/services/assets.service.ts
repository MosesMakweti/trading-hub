import { prisma } from "@/server/db";
import type { AssetInput } from "@/lib/validation/trading-plan";

export async function listAssets(userId: string) {
  return prisma.asset.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createAsset(userId: string, data: AssetInput) {
  const last = await prisma.asset.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.asset.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateAsset(userId: string, id: string, data: AssetInput) {
  return prisma.asset.update({
    where: { id, userId },
    data,
  });
}

export async function archiveAsset(userId: string, id: string) {
  return prisma.asset.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderAssets(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.asset.update({
        where: { id, userId },
        data: { sortOrder: index },
      }),
    ),
  );
}
