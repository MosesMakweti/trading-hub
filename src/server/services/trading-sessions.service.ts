import { prisma } from "@/server/db";
import type { TradingSessionInput } from "@/lib/validation/trading-plan";

export async function listTradingSessions(userId: string) {
  return prisma.tradingSession.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createTradingSession(userId: string, data: TradingSessionInput) {
  const last = await prisma.tradingSession.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
  });

  return prisma.tradingSession.create({
    data: { userId, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateTradingSession(
  userId: string,
  id: string,
  data: TradingSessionInput,
) {
  return prisma.tradingSession.update({
    where: { id, userId },
    data,
  });
}

export async function archiveTradingSession(userId: string, id: string) {
  return prisma.tradingSession.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}

export async function reorderTradingSessions(userId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.tradingSession.update({
        where: { id, userId },
        data: { sortOrder: index },
      }),
    ),
  );
}
