import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  TRADE_MANAGEMENT_RICH_FIELDS,
  type PartialTakeProfitUpdateInput,
  type TradeManagementUpdateInput,
} from "@/lib/validation/strategy-trade-management";

// Section 5 is a 1:1 record plus two child lists. The record is scoped to the
// user via its Strategy; the children via their record's strategy. updateMany /
// nested relation filters spell out `deletedAt: null` explicitly.

const ownedRecord = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  strategy: { userId, deletedAt: null },
});

const ownedChild = (userId: string, id: string) => ({
  id,
  deletedAt: null,
  tradeManagement: { deletedAt: null, strategy: { userId, deletedAt: null } },
});

/** Lazily create the singleton trade-management record so the section always has
 *  a row (and an id its children can attach to), then return it with its lists. */
export async function getOrCreateTradeManagement(userId: string, strategyId: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!strategy) throw new Error("Strategy not found.");

  try {
    await prisma.strategyTradeManagement.upsert({
      where: { strategyId },
      create: { strategyId },
      update: {},
    });
  } catch (error) {
    // Under a concurrent first-load the row may already exist — that's fine.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
  }

  // findFirstOrThrow bypasses the soft-delete extension, so filter deletedAt here.
  return prisma.strategyTradeManagement.findFirstOrThrow({
    where: { strategyId, deletedAt: null, strategy: { userId, deletedAt: null } },
    include: {
      partialTakeProfits: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      customRules: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function updateTradeManagement(
  userId: string,
  id: string,
  data: TradeManagementUpdateInput,
) {
  const patch: Record<string, unknown> = {};
  for (const key of TRADE_MANAGEMENT_RICH_FIELDS) {
    const value = data[key];
    if (value !== undefined) patch[key] = value === null ? Prisma.DbNull : value;
  }
  // String? / Decimal? / Float? / Int? columns take a literal null directly (not DbNull).
  if (data.maxHoldingTime !== undefined) patch.maxHoldingTime = data.maxHoldingTime;
  if (data.maxRiskPercent !== undefined) patch.maxRiskPercent = data.maxRiskPercent;
  if (data.expectedWinRate !== undefined) patch.expectedWinRate = data.expectedWinRate;
  if (data.expectedAvgRr !== undefined) patch.expectedAvgRr = data.expectedAvgRr;
  if (data.expectedExpectancy !== undefined) patch.expectedExpectancy = data.expectedExpectancy;
  if (data.minExecutionScore !== undefined) patch.minExecutionScore = data.minExecutionScore;

  const result = await prisma.strategyTradeManagement.updateMany({
    where: ownedRecord(userId, id),
    data: patch as Prisma.StrategyTradeManagementUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Trade management not found.");
}

// ── Partial take-profit levels ───────────────────────────────────────────────
async function assertOwnsRecord(userId: string, tradeManagementId: string) {
  const record = await prisma.strategyTradeManagement.findFirst({
    where: { id: tradeManagementId, strategy: { userId } },
  });
  if (!record) throw new Error("Trade management not found.");
}

export async function createPartialTakeProfit(userId: string, tradeManagementId: string) {
  await assertOwnsRecord(userId, tradeManagementId);
  const last = await prisma.partialTakeProfit.findFirst({
    where: { tradeManagementId },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.partialTakeProfit.create({
    data: { tradeManagementId, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updatePartialTakeProfit(
  userId: string,
  id: string,
  data: PartialTakeProfitUpdateInput,
) {
  const patch: Record<string, unknown> = {};
  if (data.trigger !== undefined) patch.trigger = data.trigger;
  if (data.percentToClose !== undefined) patch.percentToClose = data.percentToClose;
  if (data.reason !== undefined) patch.reason = data.reason;

  const result = await prisma.partialTakeProfit.updateMany({
    where: ownedChild(userId, id),
    data: patch as Prisma.PartialTakeProfitUpdateManyMutationInput,
  });
  if (result.count === 0) throw new Error("Partial take-profit not found.");
}

export async function archivePartialTakeProfit(userId: string, id: string) {
  const result = await prisma.partialTakeProfit.updateMany({
    where: ownedChild(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Partial take-profit not found.");
}

export async function reorderPartialTakeProfits(
  userId: string,
  tradeManagementId: string,
  orderedIds: string[],
) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.partialTakeProfit.updateMany({
        where: { id, tradeManagementId, tradeManagement: { strategy: { userId } } },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ── Custom rules ─────────────────────────────────────────────────────────────
export async function createCustomRule(userId: string, tradeManagementId: string, text: string) {
  await assertOwnsRecord(userId, tradeManagementId);
  const last = await prisma.tradeManagementRule.findFirst({
    where: { tradeManagementId },
    orderBy: { sortOrder: "desc" },
  });
  return prisma.tradeManagementRule.create({
    data: { tradeManagementId, text, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function updateCustomRule(userId: string, id: string, text: string) {
  const result = await prisma.tradeManagementRule.updateMany({
    where: ownedChild(userId, id),
    data: { text },
  });
  if (result.count === 0) throw new Error("Rule not found.");
}

export async function archiveCustomRule(userId: string, id: string) {
  const result = await prisma.tradeManagementRule.updateMany({
    where: ownedChild(userId, id),
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Rule not found.");
}

export async function reorderCustomRules(
  userId: string,
  tradeManagementId: string,
  orderedIds: string[],
) {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.tradeManagementRule.updateMany({
        where: { id, tradeManagementId, tradeManagement: { strategy: { userId } } },
        data: { sortOrder: index },
      }),
    ),
  );
}
