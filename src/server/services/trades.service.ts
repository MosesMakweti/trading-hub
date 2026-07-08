import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { dailyPercentFromTrades } from "@/domain/performance/rr";
import { scorePsychology, type PsychologyAnswer } from "@/domain/psychology/scoring";
import type { TradeInput } from "@/lib/validation/trades";
import { listTradingAccounts } from "@/server/services/accounts.service";
import { listAssets } from "@/server/services/assets.service";
import { listTradingSessions } from "@/server/services/trading-sessions.service";
import { listEntryModels } from "@/server/services/entry-models.service";
import { listChecklistItems } from "@/server/services/checklist-items.service";

// Composes the reference data the trade form needs (accounts/assets/
// sessions/entry-models/checklists), reusing each feature's own service
// rather than re-querying Prisma directly.
export async function getTradeFormOptions(userId: string) {
  const [accounts, assets, sessions, entryModels, confluenceItems, executionItems] =
    await Promise.all([
      listTradingAccounts(userId),
      listAssets(userId),
      listTradingSessions(userId),
      listEntryModels(userId),
      listChecklistItems(userId, "CONFLUENCE"),
      listChecklistItems(userId, "EXECUTION_CONFIRMATION"),
    ]);

  return { accounts, assets, sessions, entryModels, confluenceItems, executionItems };
}

const tradeInclude = {
  asset: true,
  session: true,
  allocations: { include: { tradingAccount: true } },
  checklistSelections: { include: { checklistItem: true } },
  entryModels: { include: { entryModel: true } },
  images: true,
  psychology: true,
} as const;

// Score is always (re)computed server-side from the answers, never trusted
// from the client — this is what guarantees a persisted score/grade can
// never drift from what the pure scoring function would produce.
function scorePsychologyAnswers(answers: TradeInput["psychologyAnswers"]) {
  const answerList: PsychologyAnswer[] = Object.entries(answers).map(([key, value]) => ({
    key,
    value,
  }));
  const { rawScore, percent, grade } = scorePsychology(answerList);
  return { answers, rawScore, psychologyPercent: percent, grade };
}

function tradeWriteData(data: TradeInput) {
  return {
    assetId: data.assetId,
    executionMinutes: data.executionMinutes,
    direction: data.direction,
    higherTimeframeBias: data.higherTimeframeBias,
    biasConfidencePercent: data.biasConfidencePercent,
    sessionId: data.sessionId,
    expectedRR: data.expectedRR,
    actualRR: data.actualRR,
    hitTP1: data.hitTP1,
    hitTP2: data.hitTP2,
    hitTP3: data.hitTP3,
    hitFullTP: data.hitFullTP,
    psychPreTradeMindset: data.psychPreTradeMindset,
    psychPostTradeReflection: data.psychPostTradeReflection,
    psychLessonsLearned: data.psychLessonsLearned,
    psychWhatToWorkOn: data.psychWhatToWorkOn,
    allocations: {
      create: data.allocations.map((a) => ({
        tradingAccountId: a.tradingAccountId,
        riskInputType: a.riskInputType,
        riskValue: a.riskValue,
        closingPnlGross: a.closingPnlGross,
        closingPnlNet: a.closingPnlNet,
      })),
    },
    checklistSelections: {
      create: data.checklistItemIds.map((checklistItemId) => ({ checklistItemId })),
    },
    entryModels: {
      create: data.entryModelIds.map((entryModelId) => ({ entryModelId })),
    },
  };
}

export async function listTradesForDay(userId: string, dateKey: string) {
  return prisma.trade.findMany({
    where: { userId, tradeDate: dateKeyToUtcDate(dateKey) },
    include: tradeInclude,
    orderBy: { executionMinutes: "asc" },
  });
}

export async function getTrade(userId: string, tradeId: string) {
  return prisma.trade.findFirst({
    where: { id: tradeId, userId },
    include: tradeInclude,
  });
}

export async function createTrade(userId: string, dateKey: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: dateKeyToUtcDate(dateKey),
      ...tradeWriteData(data),
      psychology: { create: psychology },
    },
    include: tradeInclude,
  });
}

export async function updateTrade(userId: string, tradeId: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.trade.findFirst({ where: { id: tradeId, userId } });
    if (!existing) throw new Error("Trade not found.");

    await tx.tradeAccountAllocation.deleteMany({ where: { tradeId } });
    await tx.tradeChecklistSelection.deleteMany({ where: { tradeId } });
    await tx.tradeEntryModel.deleteMany({ where: { tradeId } });

    return tx.trade.update({
      where: { id: tradeId },
      data: {
        ...tradeWriteData(data),
        psychology: { upsert: { create: psychology, update: psychology } },
      },
      include: tradeInclude,
    });
  });
}

export async function archiveTrade(userId: string, tradeId: string) {
  return prisma.trade.update({
    where: { id: tradeId, userId },
    data: { deletedAt: new Date() },
  });
}

// Backs the calendar's daily P&L badges. Returns every day with at least one
// trade — small dataset for MVP, same rationale as listNoteDateKeys.
export async function listDailyPnl(userId: string) {
  const trades = await prisma.trade.findMany({
    where: { userId },
    select: { tradeDate: true, actualRR: true },
  });

  const byDay = new Map<string, { actualRR: number | null }[]>();
  for (const t of trades) {
    const key = utcDateToKey(t.tradeDate);
    const list = byDay.get(key) ?? [];
    list.push({ actualRR: t.actualRR ? t.actualRR.toNumber() : null });
    byDay.set(key, list);
  }

  return Array.from(byDay.entries()).map(([dateKey, dayTrades]) => ({
    dateKey,
    percent: dailyPercentFromTrades(dayTrades),
    tradeCount: dayTrades.length,
  }));
}
