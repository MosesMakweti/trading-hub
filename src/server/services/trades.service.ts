import { prisma } from "@/server/db";
import { dateKeyToUtcDate } from "@/lib/date";
import { dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import { effectiveRiskPercent, scalePnlByRisk, PERFORMANCE_ACCOUNT_RISK_PERCENT } from "@/domain/performance/allocation";
import { scorePsychology, type PsychologyAnswer } from "@/domain/psychology/scoring";
import { nextClosedAt, nextReviewedAt } from "@/domain/trades/lifecycle";
import type {
  RiskInputType,
  TradeInput,
  TradeWorkspaceSectionInput,
} from "@/lib/validation/trades";
import {
  getAccountBalance,
  getAccountTrackRecord,
  getOrCreatePerformanceAccount,
  listTradingAccounts,
  PERFORMANCE_ACCOUNT_STARTING_BALANCE,
} from "@/server/services/accounts.service";
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

// The free-text fields whose presence means "this trade has been reviewed":
// the /edit form's psychology reflections plus the workspace review prompts.
const REVIEW_TEXT_FIELDS = [
  "psychPostTradeReflection",
  "psychLessonsLearned",
  "psychWhatToWorkOn",
  "whatWentWell",
  "whatWentWrong",
  "whatSurprisedMe",
] as const;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function tradeScalarData(data: TradeInput) {
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
  };
}

/**
 * Builds every allocation row for a trade: the Performance Account's own
 * (user-entered, fixed 1% risk) allocation, plus one auto-calculated
 * allocation per additional participating account, scaled from the
 * Performance Account's PnL by that account's relative risk%. When editing
 * an existing trade, `excludeTradeId` excludes the trade's own prior
 * allocations from each account's balance lookup, so risk% is computed
 * against the balance as it stood before this trade — not double-counted.
 */
async function buildAllocations(userId: string, data: TradeInput, excludeTradeId?: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const participatingAccounts = data.allocations.length
    ? await prisma.tradingAccount.findMany({
        where: { userId, id: { in: data.allocations.map((a) => a.tradingAccountId) } },
      })
    : [];

  const participating = await Promise.all(
    data.allocations.map(async (a) => {
      const account = participatingAccounts.find((acc) => acc.id === a.tradingAccountId);
      if (!account) throw new Error("Selected account not found.");
      const balance = await getAccountBalance(account.id, excludeTradeId);
      const riskPercent = effectiveRiskPercent(
        a.riskInputType as RiskInputType,
        a.riskValue,
        balance,
      );
      return {
        tradingAccountId: a.tradingAccountId,
        riskInputType: a.riskInputType,
        riskValue: a.riskValue,
        closingPnlGross: scalePnlByRisk(data.performanceClosingPnlGross, riskPercent),
        closingPnlNet: scalePnlByRisk(data.performanceClosingPnlNet, riskPercent),
      };
    }),
  );

  return [
    {
      tradingAccountId: performanceAccount.id,
      riskInputType: "PERCENT" as const,
      riskValue: PERFORMANCE_ACCOUNT_RISK_PERCENT,
      closingPnlGross: data.performanceClosingPnlGross,
      closingPnlNet: data.performanceClosingPnlNet,
    },
    ...participating,
  ];
}

export async function listTradesForDay(userId: string, dateKey: string) {
  return prisma.trade.findMany({
    where: { userId, tradeDate: dateKeyToUtcDate(dateKey) },
    include: tradeInclude,
    orderBy: { executionMinutes: "asc" },
  });
}

/** Most recent trades across all days — backs the dashboard's recent-trades list. */
export async function listRecentTrades(userId: string, limit: number) {
  return prisma.trade.findMany({
    where: { userId },
    include: tradeInclude,
    orderBy: [{ tradeDate: "desc" }, { executionMinutes: "desc" }],
    take: limit,
  });
}

export async function getTrade(userId: string, tradeId: string) {
  return prisma.trade.findFirst({
    where: { id: tradeId, userId },
    include: tradeInclude,
  });
}

/**
 * A stable-ish "Trade #N" for the workspace header: this trade's position in the
 * user's creation-ordered history. Derived (not persisted) so Phase 1 needs no
 * schema change — a real monotonic trade number is a suggested later DB addition.
 */
export async function getTradeOrdinal(userId: string, createdAt: Date) {
  return prisma.trade.count({
    where: { userId, createdAt: { lte: createdAt } },
  });
}

export async function createTrade(userId: string, dateKey: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  const allocations = await buildAllocations(userId, data);

  const now = new Date();
  const hasReview = hasText(data.psychPostTradeReflection) ||
    hasText(data.psychLessonsLearned) ||
    hasText(data.psychWhatToWorkOn);

  return prisma.trade.create({
    data: {
      userId,
      tradeDate: dateKeyToUtcDate(dateKey),
      ...tradeScalarData(data),
      closedAt: nextClosedAt(null, data.actualRR != null, now),
      reviewedAt: nextReviewedAt(null, hasReview, now),
      allocations: { create: allocations },
      checklistSelections: {
        create: data.checklistItemIds.map((checklistItemId) => ({ checklistItemId })),
      },
      entryModels: { create: data.entryModelIds.map((entryModelId) => ({ entryModelId })) },
      psychology: { create: psychology },
    },
    include: tradeInclude,
  });
}

export async function updateTrade(userId: string, tradeId: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  const allocations = await buildAllocations(userId, data, tradeId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.trade.findFirst({ where: { id: tradeId, userId } });
    if (!existing) throw new Error("Trade not found.");

    await tx.tradeAccountAllocation.deleteMany({ where: { tradeId } });
    await tx.tradeChecklistSelection.deleteMany({ where: { tradeId } });
    await tx.tradeEntryModel.deleteMany({ where: { tradeId } });

    const now = new Date();
    // The form owns the psychology reflections; the workspace review prompts
    // (whatWent*) are only on the existing row, so merge both.
    const hasReview =
      hasText(data.psychPostTradeReflection) ||
      hasText(data.psychLessonsLearned) ||
      hasText(data.psychWhatToWorkOn) ||
      hasText(existing.whatWentWell) ||
      hasText(existing.whatWentWrong) ||
      hasText(existing.whatSurprisedMe);

    return tx.trade.update({
      where: { id: tradeId },
      data: {
        ...tradeScalarData(data),
        closedAt: nextClosedAt(existing.closedAt, data.actualRR != null, now),
        reviewedAt: nextReviewedAt(existing.reviewedAt, hasReview, now),
        allocations: { create: allocations },
        checklistSelections: {
          create: data.checklistItemIds.map((checklistItemId) => ({ checklistItemId })),
        },
        entryModels: { create: data.entryModelIds.map((entryModelId) => ({ entryModelId })) },
        psychology: { upsert: { create: psychology, update: psychology } },
      },
      include: tradeInclude,
    });
  });
}

/**
 * Patches only the Trade Workspace case-file scalar columns (planned/actual
 * prices, market context, reasons, review prompts). userId-scoped via an
 * explicit ownership check first, then a keyed update — allocations,
 * psychology, checklists and the /edit form's fields are never touched, so a
 * section can autosave in isolation. Only the keys present in `patch` are
 * written (an absent key leaves the column as-is; an explicit null clears it).
 */
export async function updateTradeSections(
  userId: string,
  tradeId: string,
  patch: TradeWorkspaceSectionInput,
) {
  const existing = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!existing) throw new Error("Trade not found.");

  // Editing a review prompt inline can be the moment a trade first becomes
  // "reviewed" — stamp reviewedAt from the merged (patch over existing) view.
  const patchRecord = patch as Record<string, unknown>;
  const existingRecord = existing as unknown as Record<string, unknown>;
  const hasReview = REVIEW_TEXT_FIELDS.some((field) =>
    hasText(field in patchRecord ? patchRecord[field] : existingRecord[field]),
  );

  return prisma.trade.update({
    where: { id: tradeId },
    data: {
      ...patch,
      reviewedAt: nextReviewedAt(existing.reviewedAt, hasReview, new Date()),
    },
    include: tradeInclude,
  });
}

export async function archiveTrade(userId: string, tradeId: string) {
  return prisma.trade.update({
    where: { id: tradeId, userId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Backs the journal calendar's daily P&L badges — derived entirely from the
 * Performance Account's real dollar track record (the single source of
 * truth for all analytics), not from any self-reported RR.
 */
export async function listDailyPnl(userId: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);
  const { entries } = await getAccountTrackRecord(performanceAccount.id);

  const byDay = new Map<string, { pnl: number; count: number }>();
  for (const e of entries) {
    const existing = byDay.get(e.dateKey) ?? { pnl: 0, count: 0 };
    existing.pnl += e.pnl;
    existing.count += 1;
    byDay.set(e.dateKey, existing);
  }

  const dailyPercents = dailyPercentsFromBalanceHistory(
    PERFORMANCE_ACCOUNT_STARTING_BALANCE,
    Array.from(byDay.entries()).map(([dateKey, { pnl }]) => ({ dateKey, pnl })),
  );
  const percentByDay = new Map(dailyPercents.map((d) => [d.dateKey, d.percent]));

  return Array.from(byDay.entries()).map(([dateKey, { count }]) => ({
    dateKey,
    percent: percentByDay.get(dateKey) ?? 0,
    tradeCount: count,
  }));
}
