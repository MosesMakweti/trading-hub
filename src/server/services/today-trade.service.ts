import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { tradeSchema, type TradeInput } from "@/lib/validation/trades";
import type { QuickIdeaInput, IdeaUpdateInput, RecordEntryInput } from "@/lib/validation/today-v3";
import { allMandatoryComplete } from "@/domain/today/routine-snapshot";
import { computeDayUsage, evaluateNewTradeOverride, type NewTradeOverride } from "@/domain/today/limit-state";
import { compatibilityFields } from "@/domain/today/idea-inheritance";
import { exitedPercentFrom } from "@/domain/trades/trade-lifecycle";
import { closedMomentFrom } from "@/domain/trades/review-state";
import { scoreStrategyAdherence } from "@/domain/trades/strategy-adherence";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine } from "@/server/services/today-routine.service";
import { getPerformanceConfig } from "@/server/services/performance-account.service";
import { linkExecutedTrade } from "@/server/services/opportunity.service";
import {
  createTrade,
  getTrade,
  tradeInclude,
  updateTrade,
  updateTradeSections,
  listTradesForDay,
} from "@/server/services/trades.service";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";
import { isBacktestScope } from "@/server/workspace/scope";

/**
 * Today V3 (Phase 2) — the trade-lifecycle orchestration behind the LIVE
 * Today Trade phase. Every write goes through the canonical services
 * (createTrade / updateTrade / updateTradeSections / savePlan elsewhere);
 * this module only adapts V3 inputs, enforces the V3 web-path rules
 * (readiness gates TAKING a trade, soft-limit override reasons, an explicit
 * initial stop for planless entries) and records the limit override.
 * The TradingView extension (/api/v1/trades) does not go through here.
 */

export class TradingNotReadyError extends Error {
  constructor() {
    super("Confirm you're ready to trade in Prepare before taking a new trade.");
  }
}

export class LimitOverrideRequiredError extends Error {
  constructor(public readonly override: NewTradeOverride) {
    super(`${override.messages.join(" ")} Give a reason for overriding today's limit to continue.`);
  }
}

// ── Readiness + limits ───────────────────────────────────────────────────────

/** Same rule as the UI and setRoutineReady: confirmed AND still complete. */
export async function isTradingReady(userId: string, dateKey: string): Promise<boolean> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  const routine = await getOrCreateDayRoutine(userId, day);
  return routine.readyAt != null && allMandatoryComplete(routine.snapshot);
}

/**
 * Today's usage under the LIVE status-strip rule (Phase 1 §I, locked in
 * Phase 2 §33): trades of THIS trading day with an actual entry, risk =
 * their frozen Performance snapshot risk%. Carried positions (earlier days)
 * are excluded — they were taken, and counted, on their own day.
 */
export async function getDayLimitState(userId: string, dateKey: string, excludeTradeId?: string) {
  const [day, trades] = await Promise.all([getOrCreateTradingDay(userId, dateKey), listTradesForDay(userId, dateKey)]);
  const usage = computeDayUsage(
    trades
      .filter((t) => t.id !== excludeTradeId)
      .map((t) => ({
        hasActualEntry: t.actualEntry != null,
        cancelled: t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED",
        performanceRiskPercent: t.performanceRiskSnapshot ? t.performanceRiskSnapshot.riskPercent.toNumber() : null,
      })),
  );
  return {
    usage,
    limits: {
      riskLimitPercent: day.riskBudgetPercent ? day.riskBudgetPercent.toNumber() : null,
      maxTrades: day.maxTradesPerDay ?? null,
    },
  };
}

function overrideContextJson(override: NewTradeOverride): Prisma.InputJsonValue {
  return { ...override.context, at: new Date().toISOString() } as unknown as Prisma.InputJsonValue;
}

// ── Quick Trade Idea ─────────────────────────────────────────────────────────

/**
 * Creates a Trade Idea from the Quick Idea surface through the canonical
 * createTrade. V3 never asks for execution time, HTF bias or a confidence:
 * the schema-required values come from compatibilityFields (provisional
 * clock time, the asset's HTF read, the neutral 50).
 */
export async function createQuickIdea(userId: string, dateKey: string, input: QuickIdeaInput): Promise<{ tradeId: string }> {
  if (!(await isTradingReady(userId, dateKey))) throw new TradingNotReadyError();

  const [{ usage, limits }, perf, analysis] = await Promise.all([
    getDayLimitState(userId, dateKey),
    isBacktestScope() ? Promise.resolve(null) : getPerformanceConfig(userId),
    prisma.dailyAssetAnalysis.findFirst({
      where: { userId, assetSymbol: input.assetSymbol, deletedAt: null, tradingDay: { date: dateKeyToUtcDate(dateKey) } },
      select: { htfBias: true },
    }),
  ]);
  const override = evaluateNewTradeOverride(usage, limits, perf ? perf.defaultRiskPercent.toNumber() : null);
  const overrideReason = input.limitOverrideReason?.trim() || null;
  if (override.required && !overrideReason) throw new LimitOverrideRequiredError(override);

  const compat = compatibilityFields({
    direction: input.direction,
    assetHtfBias: (analysis?.htfBias as "BULLISH" | "BEARISH" | "NEUTRAL" | null) ?? null,
    nowMinutes: input.nowMinutes,
  });

  const tradeInput: TradeInput = tradeSchema.parse({
    strategyId: input.strategyId ?? "",
    assetSymbol: input.assetSymbol,
    direction: input.direction,
    selectedSession: input.selectedSession,
    selectedEntryModel: input.selectedEntryModel,
    selectedConfluences: input.selectedConfluences,
    setupTypeId: input.setupTypeId,
    selectedSetupConditions: input.selectedSetupConditions,
    setupOverrideReason: input.setupOverrideReason,
    setupOverrideNote: input.setupOverrideNote,
    preTradeMoodTags: input.preTradeMoodTags,
    preTradeMoodIntensity: input.preTradeMoodIntensity,
    preTradeMoodNote: input.preTradeMoodNote,
    ...compat,
  });

  const trade = await createTrade(userId, dateKey, tradeInput);

  // Narrative + accountability, written after the canonical create.
  const extra: Prisma.TradeUpdateInput = {};
  if (input.reasonForTrade?.trim()) extra.reasonForTrade = input.reasonForTrade.trim();
  if (override.required) {
    extra.limitOverrideReason = overrideReason;
    extra.limitOverrideContext = overrideContextJson(override);
  }
  if (Object.keys(extra).length > 0) {
    await prisma.trade.update({ where: { id: trade.id }, data: extra });
  }

  if (input.opportunityId) {
    // Same rule as the web create action: a failed link never fails the trade.
    await linkExecutedTrade(userId, input.opportunityId, trade.id).catch(() => undefined);
  }
  return { tradeId: trade.id };
}

/**
 * Edits an idea's strategy-scoped selections BEFORE entry, through the
 * canonical updateTrade (re-scoring, setup re-validation, bias snapshot) —
 * starting from the full stored values so nothing is cleared. After entry
 * these are frozen (as updateTrade itself freezes setup validation).
 */
export async function updateIdea(userId: string, tradeId: string, patch: IdeaUpdateInput) {
  const trade = await getTrade(userId, tradeId);
  if (!trade) throw new Error("Trade not found.");
  if (trade.actualEntry != null) throw new Error("This trade has an entry — its idea is now part of the record.");
  if (trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED") throw new Error("This idea was cancelled.");

  const base = tradeToFormValues(trade);
  const next = tradeSchema.parse({
    ...base,
    ...("strategyId" in patch ? { strategyId: patch.strategyId ?? "" } : {}),
    ...("direction" in patch ? { direction: patch.direction } : {}),
    ...("selectedSession" in patch ? { selectedSession: patch.selectedSession } : {}),
    ...("selectedEntryModel" in patch ? { selectedEntryModel: patch.selectedEntryModel } : {}),
    ...("selectedConfluences" in patch ? { selectedConfluences: patch.selectedConfluences } : {}),
    ...("setupTypeId" in patch ? { setupTypeId: patch.setupTypeId } : {}),
    ...("selectedSetupConditions" in patch ? { selectedSetupConditions: patch.selectedSetupConditions } : {}),
    ...("setupOverrideReason" in patch ? { setupOverrideReason: patch.setupOverrideReason } : {}),
    ...("setupOverrideNote" in patch ? { setupOverrideNote: patch.setupOverrideNote } : {}),
    ...("preTradeMoodTags" in patch ? { preTradeMoodTags: patch.preTradeMoodTags } : {}),
    ...("preTradeMoodIntensity" in patch ? { preTradeMoodIntensity: patch.preTradeMoodIntensity } : {}),
    ...("preTradeMoodNote" in patch ? { preTradeMoodNote: patch.preTradeMoodNote } : {}),
  });
  await updateTrade(userId, tradeId, next);
  if ("reasonForTrade" in patch) {
    await updateTradeSections(userId, tradeId, { reasonForTrade: patch.reasonForTrade?.trim() || null });
  }
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * Records the FIRST actual entry from Today V3. Taking the trade:
 *  - requires readiness (managing an already-entered trade never does);
 *  - requires a limit-override reason when today's confirmed limits would be
 *    exceeded (unless one was already recorded when the idea was created);
 *  - requires an explicit initial stop when no planned stop exists.
 * The real Entry Time replaces the provisional executionMinutes in the SAME
 * section save as actualEntry, so the Performance risk snapshot (locked by
 * updateTradeSections right after) orders against the true entry time.
 */
export async function recordFirstEntry(userId: string, dateKey: string, tradeId: string, input: RecordEntryInput) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: {
      actualEntry: true,
      plannedStopLoss: true,
      reviewLifecycleStatus: true,
      limitOverrideReason: true,
      allocations: { select: { riskValue: true, tradingAccount: { select: { kind: true } } } },
    },
  });
  if (!trade) throw new Error("Trade not found.");
  if (trade.actualEntry != null) throw new Error("An entry is already recorded — edit it in Execution.");
  if (trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED") throw new Error("This idea was cancelled.");
  if (!(await isTradingReady(userId, dateKey))) throw new TradingNotReadyError();
  if (trade.plannedStopLoss == null && input.actualStopLoss == null) {
    throw new Error("No planned stop exists — enter the initial stop you actually used.");
  }

  const { usage, limits } = await getDayLimitState(userId, dateKey, tradeId);
  const perfAlloc = trade.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");
  const override = evaluateNewTradeOverride(usage, limits, perfAlloc ? perfAlloc.riskValue.toNumber() : null);
  const reason = input.limitOverrideReason?.trim() || null;
  if (override.required && !trade.limitOverrideReason && !reason) throw new LimitOverrideRequiredError(override);
  if (override.required && reason) {
    await prisma.trade.update({
      where: { id: tradeId },
      data: { limitOverrideReason: reason, limitOverrideContext: overrideContextJson(override) },
    });
  }

  return updateTradeSections(userId, tradeId, {
    actualEntry: input.actualEntry,
    executionMinutes: input.entryMinutes,
    ...(input.actualStopLoss != null ? { actualStopLoss: input.actualStopLoss } : {}),
  });
}

/** Editing the real Entry Time after entry. The frozen risk snapshot is
 *  never recomputed (immutability) — only future ordering sees the change. */
export async function updateEntryTime(userId: string, tradeId: string, entryMinutes: number) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId }, select: { actualEntry: true } });
  if (!trade) throw new Error("Trade not found.");
  if (trade.actualEntry == null) throw new Error("Record the entry first — the entry time is set with it.");
  return updateTradeSections(userId, tradeId, { executionMinutes: entryMinutes });
}

/**
 * Execution confirmations, captured in Execution (they're execution facts).
 * Re-scored with the canonical scorer against the trade's FROZEN strategy
 * snapshot — the same inputs buildStrategyExecution uses — so the stored
 * execution/trade-quality percents match what a full re-save would write.
 */
export async function updateExecutionConfirmations(userId: string, tradeId: string, selected: string[]) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId },
    select: { strategyExecutionSnapshot: true, selectedConfluences: true, direction: true },
  });
  if (!trade) throw new Error("Trade not found.");
  const expected = trade.strategyExecutionSnapshot as unknown as Parameters<typeof scoreStrategyAdherence>[0];
  const confluences = (trade.selectedConfluences as string[] | null) ?? [];
  const unique = Array.from(new Set(selected));
  const scores = scoreStrategyAdherence(expected ?? null, confluences, unique, trade.direction);
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      selectedExecution: unique as unknown as Prisma.InputJsonValue,
      confluencePercent: scores.confluencePercent,
      executionPercent: scores.executionPercent,
      tradeQualityPercent: scores.tradeQualityPercent,
    },
  });
}

// ── Today's trade facts (loader) ─────────────────────────────────────────────

export interface TradeLifecycleFactsDTO {
  exitedPercent: number | null;
  hasConfirmedPlan: boolean;
  planLocked: boolean;
  limitOverrideReason: string | null;
  /** The FROZEN strategy snapshot's execution confirmations (the set the
   *  execution score is computed against), in strategy order. */
  expectedExecution: string[];
  /** Phase 3 — when the position became fully closed (ISO): Trade.closedAt,
   *  else Performance settledAt / the last exit time. Review state compares
   *  reviewedAt against it (interim vs final). */
  closedMoment: string | null;
}

/** Per-trade facts the V3 lifecycle derivation needs that the shared
 *  TradeWorkspaceDTO doesn't carry (kept out of the shared include so the
 *  Journal/Dashboard queries don't pay for them). */
export async function getTradeLifecycleFacts(userId: string, tradeIds: string[]): Promise<Record<string, TradeLifecycleFactsDTO>> {
  if (tradeIds.length === 0) return {};
  const [trades, partials, versions] = await Promise.all([
    prisma.trade.findMany({
      where: { id: { in: tradeIds }, userId },
      select: {
        id: true,
        actualExit: true,
        limitOverrideReason: true,
        strategyExecutionSnapshot: true,
        closedAt: true,
        performanceRiskSnapshot: { select: { settledAt: true } },
      },
    }),
    prisma.tradeActualPartialExit.findMany({
      where: { tradeId: { in: tradeIds }, userId },
      select: { tradeId: true, percentClosed: true, exitedAt: true },
    }),
    prisma.tradePlanVersion.findMany({
      where: { tradeId: { in: tradeIds } },
      orderBy: { versionNumber: "desc" },
      select: { tradeId: true, locked: true },
    }),
  ]);
  const out: Record<string, TradeLifecycleFactsDTO> = {};
  for (const t of trades) {
    const latest = versions.find((v) => v.tradeId === t.id);
    out[t.id] = {
      exitedPercent: exitedPercentFrom(
        partials.filter((p) => p.tradeId === t.id).map((p) => ({ percentClosed: p.percentClosed ? p.percentClosed.toNumber() : null })),
        t.actualExit ? t.actualExit.toNumber() : null,
      ),
      hasConfirmedPlan: latest != null,
      planLocked: latest?.locked ?? false,
      limitOverrideReason: t.limitOverrideReason,
      expectedExecution: (
        ((t.strategyExecutionSnapshot as { execution?: { name: string }[] } | null)?.execution ?? []) as { name: string }[]
      ).map((e) => e.name),
      closedMoment:
        closedMomentFrom(
          t.closedAt,
          t.performanceRiskSnapshot?.settledAt ?? null,
          partials.filter((p) => p.tradeId === t.id).map((p) => p.exitedAt),
        )?.toISOString() ?? null,
    };
  }
  return out;
}

/**
 * LIVE positions entered on an EARLIER day that are still open (plus, since
 * Phase 3, ones that closed after their day and still need a final review): an actual
 * entry, no closed result (no actualRR, not marked fully closed/cancelled),
 * Performance not settled, and less than 100% exited. Runs inside the
 * caller's workspace scope (Trade is a scoped root model), so a Backtesting
 * position can never appear on live Today. Bounded to the newest 50.
 */
export async function listCarriedOpenTrades(userId: string, dateKey: string) {
  const candidates = await prisma.trade.findMany({
    where: {
      userId,
      tradeDate: { lt: dateKeyToUtcDate(dateKey) },
      actualEntry: { not: null },
      actualRR: null,
      OR: [
        { reviewLifecycleStatus: null },
        { reviewLifecycleStatus: { notIn: ["FULLY_CLOSED", "CANCELLED_NEVER_TRIGGERED"] } },
      ],
      AND: [{ OR: [{ performanceRiskSnapshot: null }, { performanceRiskSnapshot: { settledAt: null } }] }],
    },
    include: tradeInclude,
    orderBy: [{ tradeDate: "desc" }, { executionMinutes: "desc" }],
    take: 50,
  });
  const facts = candidates.length ? await getTradeLifecycleFacts(userId, candidates.map((t) => t.id)) : {};
  const open = candidates.filter((t) => (facts[t.id]?.exitedPercent ?? 0) < 100);

  // Phase 3 — a carried position that has since fully closed stays listed
  // until its FINAL review is done (Trade.status is REVIEWED only then; see
  // trade-lifecycle-sync.service.ts), bounded to closes in the last 7 days.
  const dayStart = dateKeyToUtcDate(dateKey).getTime();
  const since = new Date(dayStart - 7 * 86_400_000);
  // Upper bound: closes up to the viewed day (+1 day of timezone slack).
  const until = new Date(dayStart + 2 * 86_400_000);
  const awaitingReview = await prisma.trade.findMany({
    where: {
      userId,
      tradeDate: { lt: dateKeyToUtcDate(dateKey) },
      actualEntry: { not: null },
      reviewLifecycleStatus: "FULLY_CLOSED",
      status: { not: "REVIEWED" },
      closedAt: { gte: since, lt: until },
      id: { notIn: open.map((t) => t.id) },
    },
    include: tradeInclude,
    orderBy: [{ closedAt: "desc" }],
    take: 20,
  });
  // Only positions actually carried past their own day.
  return [...open, ...awaitingReview.filter((t) => t.closedAt && utcDateToKey(t.closedAt) > utcDateToKey(t.tradeDate))];
}
