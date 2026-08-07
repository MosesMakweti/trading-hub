import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate } from "@/lib/date";
import { dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import { effectiveRiskPercent, scalePnlByRisk, PERFORMANCE_ACCOUNT_RISK_PERCENT } from "@/domain/performance/allocation";
import { scorePsychology, type PsychologyAnswer } from "@/domain/psychology/scoring";
import { deriveStatus, nextClosedAt, nextReviewedAt } from "@/domain/trades/lifecycle";
import { sanitizeAdherenceAnswers, scoreAdherence } from "@/domain/trades/adherence";
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
import { getStrategyReference, listStrategies } from "@/server/services/strategies.service";
import { scoreStrategyAdherence } from "@/domain/trades/strategy-adherence";

// Composes the reference data the trade form needs (accounts/assets/
// sessions/entry-models/checklists), reusing each feature's own service
// rather than re-querying Prisma directly.
export async function getTradeFormOptions(userId: string) {
  // Confluences / execution confirmations are no longer global — they come from
  // the selected strategy (SOT). Assets + sessions stay global for now (still the
  // trade form's source until the asset/session FK migration in P9).
  const [accounts, assets, sessions, entryModels, strategies] = await Promise.all([
    listTradingAccounts(userId),
    listAssets(userId),
    listTradingSessions(userId),
    listEntryModels(userId),
    listStrategies(userId),
  ]);

  // Only offer non-archived strategies for a new selection; the edit page adds
  // back a currently-linked archived strategy so it stays visible.
  const selectableStrategies = strategies.filter((s) => s.status !== "ARCHIVED");

  return {
    accounts,
    assets,
    sessions,
    entryModels,
    strategies: selectableStrategies,
  };
}

const tradeInclude = {
  asset: true,
  session: true,
  // Live reference for linking only. The nested include is NOT soft-delete
  // filtered (the extension only guards top-level queries), so `deletedAt` is
  // selected too — a soft-deleted strategy must not render a live link. The
  // *Snapshot columns on Trade preserve the strategy identity regardless.
  strategy: { select: { id: true, name: true, version: true, status: true, deletedAt: true } },
  allocations: { include: { tradingAccount: true } },
  checklistSelections: { include: { checklistItem: true } },
  entryModels: { include: { entryModel: true } },
  images: true,
  psychology: true,
} as const;

/** A Trade with all the relations the Trade Workspace DTO needs. Returned by
 *  getTrade / listTradesForDay / listRecentTrades; mapped by toTradeWorkspaceDTO. */
export type TradeWithWorkspaceRelations = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

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

/**
 * Freezes the strategy reference + display snapshots at save time. The strategy
 * name/version come from the strategy's *current* state; the entry-model names
 * are the selected models' names joined in selection order. All are stored on the
 * Trade so a completed trade keeps showing the strategy as it was when saved,
 * even if the strategy is later versioned, renamed, or deleted. A strategyId that
 * doesn't belong to the user is dropped (treated as no strategy).
 */
type StrategySnapshot = {
  strategyId: string | null;
  strategyNameSnapshot: string | null;
  strategyVersionSnapshot: number | null;
};

async function buildTradeSnapshots(
  userId: string,
  data: TradeInput,
  existing?: StrategySnapshot,
) {
  // Entry-model names always reflect the current selection (they're part of the
  // trade, not the strategy).
  const entryModels = data.entryModelIds.length
    ? await prisma.entryModel.findMany({
        where: { userId, id: { in: data.entryModelIds } },
      })
    : [];
  const nameById = new Map(entryModels.map((m) => [m.id, m.name]));
  const orderedNames = data.entryModelIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => Boolean(name));
  const entryModelNameSnapshot = orderedNames.length ? orderedNames.join(", ") : null;

  // The strategy snapshot is FROZEN once linked: while the selection is unchanged
  // it's kept exactly as-is — even if the strategy was since renamed, versioned,
  // or deleted — so a completed trade never loses the strategy it was taken under
  // (re-deriving here would wipe the snapshot the moment its strategy is gone).
  // Recompute only when the selection actually changes (or on create).
  if (existing && data.strategyId === existing.strategyId) {
    return { ...existing, entryModelNameSnapshot };
  }

  let strategyId: string | null = null;
  let strategyNameSnapshot: string | null = null;
  let strategyVersionSnapshot: number | null = null;

  if (data.strategyId) {
    const strategy = await prisma.strategy.findFirst({
      where: { id: data.strategyId, userId },
      select: { id: true, name: true, version: true },
    });
    if (strategy) {
      strategyId = strategy.id;
      strategyNameSnapshot = strategy.name;
      strategyVersionSnapshot = strategy.version;
    }
  }

  return { strategyId, strategyNameSnapshot, strategyVersionSnapshot, entryModelNameSnapshot };
}

interface FrozenExpected {
  sessions: { name: string; color: string }[];
  confluences: { name: string; color: string; category: string | null; weight: number | null }[];
  execution: { name: string; color: string; category: string | null; weight: number | null }[];
}

/**
 * Strategy = single source of truth: freeze the strategy's expected confluences /
 * execution set at trade time, record what the trader selected (enriched with each
 * tag's color so the record is self-contained), and score adherence. Frozen on the
 * first save; kept on update while the strategy selection is unchanged.
 */
async function buildStrategyExecution(
  userId: string,
  data: TradeInput,
  existing?: { strategyId: string | null; strategyExecutionSnapshot: Prisma.JsonValue | null },
) {
  let expected: FrozenExpected | null = null;
  if (existing && data.strategyId === existing.strategyId && existing.strategyExecutionSnapshot) {
    expected = existing.strategyExecutionSnapshot as unknown as FrozenExpected;
  } else if (data.strategyId) {
    const ref = await getStrategyReference(userId, data.strategyId);
    expected = ref ? { sessions: ref.sessions, confluences: ref.confluences, execution: ref.execution } : null;
  }

  const scores = scoreStrategyAdherence(expected, data.selectedConfluences, data.selectedExecution);

  // selected* are stored as plain name arrays; each name's color is resolved at
  // render time from the frozen `strategyExecutionSnapshot` (the expected set),
  // so the record stays compact and a single source carries the colors.
  return {
    strategyExecutionSnapshot: (expected ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    selectedConfluences: data.selectedConfluences as unknown as Prisma.InputJsonValue,
    selectedExecution: data.selectedExecution as unknown as Prisma.InputJsonValue,
    confluencePercent: scores.confluencePercent,
    executionPercent: scores.executionPercent,
    tradeQualityPercent: scores.tradeQualityPercent,
  };
}

export async function listTradesForDay(userId: string, dateKey: string) {
  return prisma.trade.findMany({
    where: { userId, tradeDate: dateKeyToUtcDate(dateKey) },
    include: tradeInclude,
    orderBy: { executionMinutes: "asc" },
  });
}

/** Every trade across all days, newest first — backs the Trade Gallery (P8). */
export async function listAllTrades(userId: string) {
  return prisma.trade.findMany({
    where: { userId },
    include: tradeInclude,
    orderBy: [{ tradeDate: "desc" }, { executionMinutes: "desc" }],
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

/**
 * The next per-user trade number: MAX(tradeNumber)+1 including soft-deleted rows
 * (raw query bypasses the soft-delete filter) so numbers are stable and never
 * reused. The @@unique([userId, tradeNumber]) guards against a rare concurrent
 * collision — the second create would fail and can be retried.
 */
async function nextTradeNumber(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ max: number }[]>`
    SELECT COALESCE(MAX("tradeNumber"), 0)::int AS max FROM "Trade" WHERE "userId" = ${userId}
  `;
  return (rows[0]?.max ?? 0) + 1;
}

export async function createTrade(userId: string, dateKey: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  const allocations = await buildAllocations(userId, data);
  const snapshots = await buildTradeSnapshots(userId, data);
  const strategyExec = await buildStrategyExecution(userId, data);
  const tradeNumber = await nextTradeNumber(userId);

  const now = new Date();
  const hasReview = hasText(data.psychPostTradeReflection) ||
    hasText(data.psychLessonsLearned) ||
    hasText(data.psychWhatToWorkOn);
  const closedAt = nextClosedAt(null, data.actualRR != null, now);
  const reviewedAt = nextReviewedAt(null, hasReview, now);

  return prisma.trade.create({
    data: {
      userId,
      tradeDate: dateKeyToUtcDate(dateKey),
      ...tradeScalarData(data),
      ...snapshots,
      tradeNumber,
      closedAt,
      reviewedAt,
      status: deriveStatus(closedAt, reviewedAt),
      ...strategyExec,
      allocations: { create: allocations },
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

    // Pass the existing snapshot so an unchanged strategy selection stays frozen.
    const snapshots = await buildTradeSnapshots(userId, data, {
      strategyId: existing.strategyId,
      strategyNameSnapshot: existing.strategyNameSnapshot,
      strategyVersionSnapshot: existing.strategyVersionSnapshot,
    });
    const strategyExec = await buildStrategyExecution(userId, data, {
      strategyId: existing.strategyId,
      strategyExecutionSnapshot: existing.strategyExecutionSnapshot,
    });

    await tx.tradeAccountAllocation.deleteMany({ where: { tradeId } });
    // Clear any legacy global checklist selections — new trades use selected* JSON.
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

    const closedAt = nextClosedAt(existing.closedAt, data.actualRR != null, now);
    const reviewedAt = nextReviewedAt(existing.reviewedAt, hasReview, now);

    return tx.trade.update({
      where: { id: tradeId },
      data: {
        ...tradeScalarData(data),
        ...snapshots,
        closedAt,
        reviewedAt,
        status: deriveStatus(closedAt, reviewedAt),
        ...strategyExec,
        allocations: { create: allocations },
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
  const reviewedAt = nextReviewedAt(existing.reviewedAt, hasReview, new Date());

  // Adherence answers, when present, are sanitized to known keys and rescored
  // server-side so the denormalized percent can never drift from the answers.
  const adherence =
    "adherenceAnswers" in patchRecord
      ? (() => {
          const answers = sanitizeAdherenceAnswers(patchRecord.adherenceAnswers);
          return { adherenceAnswers: answers, adherencePercent: scoreAdherence(answers).percent };
        })()
      : {};

  return prisma.trade.update({
    where: { id: tradeId },
    data: {
      ...patch,
      ...adherence,
      reviewedAt,
      status: deriveStatus(existing.closedAt, reviewedAt),
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
