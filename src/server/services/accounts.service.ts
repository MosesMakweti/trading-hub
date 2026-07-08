import { prisma } from "@/server/db";
import type { BrokerageAccountInput, PropFirmAccountInput } from "@/lib/validation/accounts";

export async function listTradingAccounts(userId: string) {
  return prisma.tradingAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createPropFirmAccount(userId: string, data: PropFirmAccountInput) {
  return prisma.tradingAccount.create({
    data: { userId, kind: "PROP_FIRM", ...data },
  });
}

export async function updatePropFirmAccount(
  userId: string,
  id: string,
  data: PropFirmAccountInput,
) {
  return prisma.tradingAccount.update({
    where: { id, userId, kind: "PROP_FIRM" },
    data,
  });
}

export async function createBrokerageAccount(userId: string, data: BrokerageAccountInput) {
  return prisma.tradingAccount.create({
    data: { userId, kind: "PERSONAL_BROKERAGE", ...data },
  });
}

export async function updateBrokerageAccount(
  userId: string,
  id: string,
  data: BrokerageAccountInput,
) {
  return prisma.tradingAccount.update({
    where: { id, userId, kind: "PERSONAL_BROKERAGE" },
    data,
  });
}

// Trades don't exist until Phase 5 (Trade/TradeAccountAllocation); once they
// do, this should count linked allocations so the delete confirmation can
// warn with a real number instead of just a generic confirmation.
export async function archiveTradingAccount(userId: string, id: string) {
  return prisma.tradingAccount.update({
    where: { id, userId },
    data: { deletedAt: new Date() },
  });
}
