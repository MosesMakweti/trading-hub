import { Prisma, type TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { isBacktestScope } from "@/server/workspace/scope";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { reconcileDayTradesForClose } from "@/server/services/close-day.service";
import { getTradeReviewFacts } from "@/server/services/trade-review-v3.service";
import { listCarriedOpenTrades } from "@/server/services/today-trade.service";
import {
  deriveClosePerformance,
  deriveCloseProcess,
  deriveNeedsAttention,
  hasDayReflection,
  type AttentionItem,
  type CloseProcess,
  type ClosePerformance,
  type CloseTradeFacts,
  type DayReflection,
} from "@/domain/today/close-day";
import type { LimitOverrideContext } from "@/domain/trades/review-evidence";
import type { CloseTradingDayInput } from "@/lib/validation/close-day";
import type { MissReason, MissedOutcome } from "@/types/opportunity";

/**
 * Today V3 (Phase 4) — CLOSE: one end-of-day surface for LIVE Today.
 *
 * Reads only canonical data and derives everything it can (performance,
 * process, needs attention) through domain/today/close-day.ts; review
 * completeness comes from the centralized V3 review state
 * (getTradeReviewFacts), never `reviewedAt != null`. The close itself
 * evolves the canonical close-day path (lifecycle reconcile, then the
 * TradingDay ARCHIVED/archivedAt stamp endDay uses) — no second archive
 * mechanism — and writes the day reflection, Focus for Tomorrow and
 * analyzedAt in that same single row update, so a close can't half-apply.
 * Backtesting/Replay keep the V2 Day Summary + Close dialog.
 */

export interface CloseOpenPositionDTO {
  tradeId: string;
  tradeNumber: number | null;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  openPercent: number;
  carried: boolean;
  tradeDateKey: string;
}

export interface CloseMissedOpportunityDTO {
  id: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  strategyName: string | null;
  setupValid: boolean | null;
  missReason: MissReason | null;
  missNote: string | null;
  missedOutcome: MissedOutcome | null;
  missedRealizedR: number | null;
  originTrade: { id: string; tradeNumber: number | null } | null;
}

export interface CloseCancelledIdeaDTO {
  tradeId: string;
  tradeNumber: number | null;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  cancellationReason: string | null;
  recordedAsMissed: boolean;
}

export interface CloseLimitOverrideDTO {
  tradeId: string;
  tradeNumber: number | null;
  assetSymbol: string;
  reason: string;
  /** The FROZEN context recorded at override time — never recalculated. */
  context: LimitOverrideContext | null;
}

export interface CloseSetupOverrideDTO {
  tradeId: string;
  tradeNumber: number | null;
  assetSymbol: string;
  reason: string | null;
  note: string | null;
}

export interface CloseDayV3DTO {
  dateKey: string;
  status: "ACTIVE" | "ARCHIVED";
  archivedAt: string | null;
  analyzedAt: string | null;
  performance: ClosePerformance;
  process: CloseProcess;
  needsAttention: AttentionItem[];
  openPositions: CloseOpenPositionDTO[];
  missedOpportunities: CloseMissedOpportunityDTO[];
  cancelledIdeas: CloseCancelledIdeaDTO[];
  limitOverrides: CloseLimitOverrideDTO[];
  setupOverrides: CloseSetupOverrideDTO[];
  reflection: DayReflection;
  reflectionPresent: boolean;
}

const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : d.toNumber());

const closeTradeSelect = {
  id: true,
  tradeNumber: true,
  tradeDate: true,
  assetSymbol: true,
  direction: true,
  reviewLifecycleStatus: true,
  cancellationReason: true,
  adherenceAnswers: true,
  tradeIntent: true,
  wouldTakeAgain: true,
  setupScore: true,
  setupValid: true,
  validationState: true,
  overrideReason: true,
  overrideNote: true,
  executionPercent: true,
  tradeQualityPercent: true,
  limitOverrideReason: true,
  limitOverrideContext: true,
  psychology: { select: { psychologyPercent: true } },
  performanceRiskSnapshot: { select: { riskPercent: true } },
} as const satisfies Prisma.TradeSelect;

/** The Close phase read model for one LIVE day. */
export async function getCloseDayV3(userId: string, dateKey: string): Promise<CloseDayV3DTO> {
  const date = dateKeyToUtcDate(dateKey);
  const [day, todayTrades, carriedRaw, missedRows] = await Promise.all([
    prisma.tradingDay.findFirst({ where: { userId, date } }),
    prisma.trade.findMany({
      where: { userId, tradeDate: date, deletedAt: null },
      select: closeTradeSelect,
      orderBy: [{ tradeNumber: "asc" }, { createdAt: "asc" }],
    }),
    // Same carried-position rule as the Today trade list (open, or closed
    // after its day and still awaiting the final review).
    listCarriedOpenTrades(userId, dateKey),
    prisma.tradeOpportunity.findMany({
      where: { userId, spottedAt: date, status: "MISSED", deletedAt: null },
      include: { originTrade: { select: { id: true, tradeNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const carriedIds = carriedRaw.map((t) => t.id);
  const carriedTrades = carriedIds.length
    ? await prisma.trade.findMany({ where: { id: { in: carriedIds }, userId }, select: closeTradeSelect })
    : [];
  const all = [...todayTrades.map((t) => ({ t, carried: false })), ...carriedTrades.map((t) => ({ t, carried: true }))];

  const [reviewFacts, recordedMissed] = await Promise.all([
    getTradeReviewFacts(userId, all.map(({ t }) => t.id)),
    prisma.tradeOpportunity.findMany({
      where: { userId, originTradeId: { in: todayTrades.map((t) => t.id) }, deletedAt: null },
      select: { originTradeId: true },
    }),
  ]);
  const recordedSet = new Set(recordedMissed.map((o) => o.originTradeId));

  const facts: CloseTradeFacts[] = all.flatMap(({ t, carried }) => {
    const r = reviewFacts[t.id];
    if (!r) return [];
    return [
      {
        id: t.id,
        tradeNumber: t.tradeNumber,
        assetSymbol: t.assetSymbol,
        direction: t.direction,
        carried,
        tradeDateKey: utcDateToKey(t.tradeDate),
        reviewState: r.state,
        hasEarlierReview: r.hasEarlierReview,
        missingReviewCount: r.missing.length,
        hasActualEntry: r.hasActualEntry,
        cancelled: r.cancelled,
        closed: r.closed,
        exitedPercent: r.exitedPercent,
        settled: r.settled,
        hasPerformanceSnapshot: r.hasPerformanceSnapshot,
        resolvedInitialStop: r.resolvedInitialStop,
        settledRealizedR: r.settledRealizedR,
        settledPnl: r.settledPnl,
        storedLifecycle: t.reviewLifecycleStatus,
        performanceRiskPercent: num(t.performanceRiskSnapshot?.riskPercent),
        adherenceAnswers: (t.adherenceAnswers as Record<string, boolean> | null) ?? {},
        tradeIntent: t.tradeIntent,
        wouldTakeAgain: t.wouldTakeAgain,
        psychologyPercent: t.psychology?.psychologyPercent ?? null,
        setupScore: t.setupScore,
        setupValid: t.setupValid,
        setupOverridden: t.validationState === "OVERRIDDEN",
        executionPercent: t.executionPercent,
        tradeQualityPercent: t.tradeQualityPercent,
        hasLimitOverride: t.limitOverrideReason != null,
      } satisfies CloseTradeFacts,
    ];
  });

  const reflection: DayReflection = {
    dayWentWell: day?.dayWentWell ?? null,
    dayToImprove: day?.dayToImprove ?? null,
    dayMainLesson: day?.dayMainLesson ?? null,
    dayCarryForward: day?.dayCarryForward ?? null,
  };

  return {
    dateKey,
    status: day?.status ?? "ACTIVE",
    archivedAt: day?.archivedAt?.toISOString() ?? null,
    analyzedAt: day?.analyzedAt?.toISOString() ?? null,
    performance: deriveClosePerformance(facts, missedRows.map((m) => ({ setupValid: m.setupValid }))),
    process: deriveCloseProcess(facts),
    needsAttention: deriveNeedsAttention(facts),
    openPositions: facts
      .filter((f) => f.hasActualEntry && !f.cancelled && !f.closed)
      .map((f) => ({
        tradeId: f.id,
        tradeNumber: f.tradeNumber,
        assetSymbol: f.assetSymbol,
        direction: f.direction,
        openPercent: f.exitedPercent == null ? 100 : Math.max(0, Math.round((100 - f.exitedPercent) * 100) / 100),
        carried: f.carried,
        tradeDateKey: f.tradeDateKey,
      })),
    missedOpportunities: missedRows.map((m) => ({
      id: m.id,
      assetSymbol: m.assetSymbol,
      direction: m.direction,
      strategyName: m.strategyNameSnapshot,
      setupValid: m.setupValid,
      missReason: m.missReason as MissReason | null,
      missNote: m.missNote,
      missedOutcome: m.missedOutcome as MissedOutcome | null,
      missedRealizedR: num(m.missedRealizedR),
      originTrade: m.originTrade ? { id: m.originTrade.id, tradeNumber: m.originTrade.tradeNumber } : null,
    })),
    cancelledIdeas: todayTrades
      .filter((t) => t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED" && reviewFacts[t.id]?.hasActualEntry === false)
      .map((t) => ({
        tradeId: t.id,
        tradeNumber: t.tradeNumber,
        assetSymbol: t.assetSymbol,
        direction: t.direction,
        cancellationReason: t.cancellationReason,
        recordedAsMissed: recordedSet.has(t.id),
      })),
    limitOverrides: todayTrades
      .filter((t) => t.limitOverrideReason != null)
      .map((t) => ({
        tradeId: t.id,
        tradeNumber: t.tradeNumber,
        assetSymbol: t.assetSymbol,
        reason: t.limitOverrideReason as string,
        context: (t.limitOverrideContext as unknown as LimitOverrideContext | null) ?? null,
      })),
    setupOverrides: todayTrades
      .filter((t) => t.validationState === "OVERRIDDEN")
      .map((t) => ({
        tradeId: t.id,
        tradeNumber: t.tradeNumber,
        assetSymbol: t.assetSymbol,
        reason: t.overrideReason,
        note: t.overrideNote,
      })),
    reflection,
    reflectionPresent: hasDayReflection(reflection),
  };
}

export class DayAlreadyClosedError extends Error {
  constructor() {
    super("This day is already closed — reopen it to make changes.");
    this.name = "DayAlreadyClosedError";
  }
}

/**
 * CLOSE TRADING DAY (V3, LIVE). In order:
 *  1. reconcile every trade's stored lifecycle columns from its facts
 *     (idempotent; LIVE entered trades via the Phase 3 sync, which never
 *     marks a trade REVIEWED without its FINAL review);
 *  2. ONE TradingDay row update: the reflection fields the trader edited
 *     (went well / improve / main lesson / Focus for Tomorrow), analyzedAt
 *     (stamped only if not already set — historical stamps are never
 *     rewritten), and the same ARCHIVED + archivedAt that endDay writes.
 * Never touches trades' execution/review/Performance data: open positions
 * stay open, incomplete final reviews stay outstanding, missed opportunities
 * stay as recorded. Nothing is fabricated to make the day "complete".
 */
export async function closeTradingDayV3(userId: string, dateKey: string, reflection: CloseTradingDayInput): Promise<TradingDay> {
  if (isBacktestScope()) throw new Error("Backtesting days close through the Backtesting session.");
  const day = await getOrCreateTradingDay(userId, dateKey);
  if (day.status === "ARCHIVED") throw new DayAlreadyClosedError();

  await reconcileDayTradesForClose(userId, dateKey);

  const now = new Date();
  return prisma.tradingDay.update({
    where: { id: day.id },
    data: {
      ...("dayWentWell" in reflection ? { dayWentWell: reflection.dayWentWell ?? null } : {}),
      ...("dayToImprove" in reflection ? { dayToImprove: reflection.dayToImprove ?? null } : {}),
      ...("dayMainLesson" in reflection ? { dayMainLesson: reflection.dayMainLesson ?? null } : {}),
      ...("dayCarryForward" in reflection ? { dayCarryForward: reflection.dayCarryForward ?? null } : {}),
      analyzedAt: day.analyzedAt ?? now,
      status: "ARCHIVED",
      archivedAt: now,
    },
  });
}

// ── FROM YOUR LAST SESSION ───────────────────────────────────────────────────

export interface CarryForwardDTO {
  fromDateKey: string;
  carryForward: string | null;
  mainLesson: string | null;
  toImprove: string | null;
}

/**
 * The previous session's carry-forward, read by reference (never copied into
 * the next day), so an edit after reopening shows up immediately.
 *
 * Rule: the most recent TradingDay STRICTLY BEFORE `dateKey`, in the caller's
 * workspace scope, that has Focus / Main lesson / Needs improvement text.
 *  - Not "date − 1": Friday's close reaches Monday (no weekend rows), and a
 *    day opened but left without a reflection (e.g. an empty auto-created
 *    LIVE row) never hides the last session that did leave one.
 *  - TradingDay is a workspace-scoped root model (prisma-scope.ts): under
 *    runLive it sees only LIVE days (backtestRunId = null), so a Backtesting
 *    or Replay day can never become the "previous LIVE session". Inside a
 *    backtest run it sees only that run's earlier simulated days.
 */
export async function getLastSessionCarryForward(userId: string, dateKey: string): Promise<CarryForwardDTO | null> {
  const previous = await prisma.tradingDay.findFirst({
    where: {
      userId,
      date: { lt: dateKeyToUtcDate(dateKey) },
      OR: [{ dayCarryForward: { not: null } }, { dayMainLesson: { not: null } }, { dayToImprove: { not: null } }],
    },
    orderBy: { date: "desc" },
    select: { date: true, dayCarryForward: true, dayMainLesson: true, dayToImprove: true },
  });
  if (!previous) return null;
  return {
    fromDateKey: utcDateToKey(previous.date),
    carryForward: previous.dayCarryForward,
    mainLesson: previous.dayMainLesson,
    toImprove: previous.dayToImprove,
  };
}
