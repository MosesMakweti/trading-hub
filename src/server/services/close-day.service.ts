import type { TagColor, TradingDay } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { computeTradeExecutionSummary } from "@/domain/trades/trade-execution-summary";
import { getOrCreateTradingDay, endDay } from "@/server/services/trading-day.service";
import { reconcileTradeLifecycleForTrade } from "@/server/services/trade-review.service";
import type { DailyReflectionInput, CloseTradingDayInput } from "@/lib/validation/close-day";

/**
 * Close Trading Day (Stage 8) — summarizes existing evidence (Stages 4-7's
 * frozen snapshots + actual-execution data) and finalizes the day by REUSING
 * the existing endDay/archive mechanism (trading-day.service.ts) rather than
 * building a second one. Never recalculates historical strategy/setup
 * evidence from live Strategy Lab state — every figure here is read straight
 * off already-frozen Trade columns.
 */

function tradeWhereForDay(userId: string, dateKey: string) {
  return { userId, tradeDate: dateKeyToUtcDate(dateKey), deletedAt: null } as const;
}

const dayCloseTradeInclude = {
  actualPartialExits: true,
  performanceRiskSnapshot: { select: { initialStop: true, realizedR: true, performancePnl: true, settledAt: true } },
  behaviourLabels: { include: { behaviourLabel: true } },
} as const;

export interface BehaviourLabelCountDTO {
  id: string;
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
  color: TagColor;
  count: number;
}

export interface DayCloseSummaryDTO {
  dateKey: string;
  dayStatus: "ACTIVE" | "ARCHIVED";
  tradeCount: number;
  fullyClosedCount: number;
  partiallyClosedCount: number;
  stillHoldingCount: number;
  cancelledCount: number;
  /** Executed (has an actual entry) but never given a reviewLifecycleStatus. */
  unresolvedCount: number;
  totalRealizedRSoFar: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  overrideCount: number;
  averageTradeQualityPercent: number | null;
  behaviourLabels: BehaviourLabelCountDTO[];
  reflection: {
    dayWentWell: string | null;
    dayToImprove: string | null;
    dayMainLesson: string | null;
    dayCarryForward: string | null;
  };
  /** Informational — Close Day never hard-blocks on these (Stage 8 §5). */
  warnings: string[];
}

/** The compact pre-close summary + readiness warnings (Stage 8 §1/§5/§8/§9). */
export async function getDayCloseSummary(userId: string, dateKey: string): Promise<DayCloseSummaryDTO> {
  const [day, trades] = await Promise.all([
    prisma.tradingDay.findFirst({ where: { userId, date: dateKeyToUtcDate(dateKey) } }),
    prisma.trade.findMany({ where: tradeWhereForDay(userId, dateKey), include: dayCloseTradeInclude }),
  ]);

  let fullyClosedCount = 0;
  let partiallyClosedCount = 0;
  let stillHoldingCount = 0;
  let cancelledCount = 0;
  let unresolvedCount = 0;
  let totalRealizedRSoFar = 0;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let overrideCount = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  const warnings: string[] = [];
  const labelCounts = new Map<string, BehaviourLabelCountDTO>();

  let noReflectionCount = 0;
  let contradictoryFullyClosedCount = 0;

  for (const trade of trades) {
    switch (trade.reviewLifecycleStatus) {
      case "FULLY_CLOSED":
        fullyClosedCount++;
        break;
      case "PARTIALLY_CLOSED":
        partiallyClosedCount++;
        break;
      case "STILL_HOLDING":
        stillHoldingCount++;
        break;
      case "CANCELLED_NEVER_TRIGGERED":
        cancelledCount++;
        break;
      default:
        if (trade.actualEntry != null) unresolvedCount++;
    }

    if (trade.validationState === "OVERRIDDEN") overrideCount++;
    if (trade.tradeQualityPercent != null) {
      qualitySum += trade.tradeQualityPercent;
      qualityCount++;
    }

    // Cancelled ideas never contribute R/PnL/win-loss (Stage 8 §4/§11) — the
    // executionSummary math is skipped entirely rather than trusted to
    // naturally return nulls, so a cancelled idea's stray actual fields
    // (there shouldn't be any) can never leak into the totals.
    if (trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED") {
      const summary = computeTradeExecutionSummary({
        direction: trade.direction,
        actualEntry: trade.actualEntry?.toString() ?? null,
        actualStopLoss: trade.actualStopLoss?.toString() ?? null,
        actualExit: trade.actualExit?.toString() ?? null,
        resolvedInitialStop: trade.performanceRiskSnapshot?.initialStop?.toString() ?? null,
        partials: trade.actualPartialExits.map((p) => ({
          exitPrice: p.exitPrice.toString(),
          percentClosed: p.percentClosed?.toString() ?? null,
        })),
        settled: trade.performanceRiskSnapshot?.settledAt != null,
        settledRealizedR: trade.performanceRiskSnapshot?.realizedR?.toString() ?? null,
        settledPnl: trade.performanceRiskSnapshot?.performancePnl?.toString() ?? null,
      });

      if (summary.realizedRSoFar != null) totalRealizedRSoFar += summary.realizedRSoFar;
      if (summary.pnl != null) totalPnl += summary.pnl;

      if (trade.reviewLifecycleStatus === "FULLY_CLOSED") {
        if (trade.actualRR != null) {
          const r = trade.actualRR.toNumber();
          if (r > 0.001) wins++;
          else if (r < -0.001) losses++;
          else breakevens++;
        } else {
          contradictoryFullyClosedCount++;
        }
      }
    }

    const hasReflectionText = [trade.whatWentWell, trade.whatWentWrong, trade.whatCouldImprove].some(
      (v) => typeof v === "string" && v.trim() !== "",
    );
    if (
      !hasReflectionText &&
      (trade.reviewLifecycleStatus === "FULLY_CLOSED" || trade.reviewLifecycleStatus === "PARTIALLY_CLOSED")
    ) {
      noReflectionCount++;
    }

    for (const link of trade.behaviourLabels) {
      const label = link.behaviourLabel;
      if (label.deletedAt) continue;
      const existing = labelCounts.get(label.id);
      if (existing) existing.count++;
      else labelCounts.set(label.id, { id: label.id, name: label.name, polarity: label.polarity, color: label.color, count: 1 });
    }
  }

  if (unresolvedCount > 0) {
    warnings.push(
      `${unresolvedCount} executed trade${unresolvedCount === 1 ? "" : "s"} ${unresolvedCount === 1 ? "has" : "have"} no review status set yet.`,
    );
  }
  if (contradictoryFullyClosedCount > 0) {
    warnings.push(
      `${contradictoryFullyClosedCount} trade${contradictoryFullyClosedCount === 1 ? " is" : "s are"} marked Fully Closed but ${contradictoryFullyClosedCount === 1 ? "doesn't" : "don't"} have enough execution data to determine a result yet.`,
    );
  }
  if (noReflectionCount > 0) {
    warnings.push(`${noReflectionCount} closed trade${noReflectionCount === 1 ? "" : "s"} ${noReflectionCount === 1 ? "has" : "have"} no reflection notes yet.`);
  }
  const stillOpenCount = partiallyClosedCount + stillHoldingCount;
  if (stillOpenCount > 0) {
    warnings.push(
      `${stillOpenCount} trade${stillOpenCount === 1 ? "" : "s"} will remain open after this day closes (partially closed / still holding).`,
    );
  }

  return {
    dateKey,
    dayStatus: day?.status ?? "ACTIVE",
    tradeCount: trades.length,
    fullyClosedCount,
    partiallyClosedCount,
    stillHoldingCount,
    cancelledCount,
    unresolvedCount,
    totalRealizedRSoFar,
    totalPnl,
    wins,
    losses,
    breakevens,
    overrideCount,
    averageTradeQualityPercent: qualityCount > 0 ? qualitySum / qualityCount : null,
    behaviourLabels: Array.from(labelCounts.values()).sort((a, b) => b.count - a.count),
    reflection: {
      dayWentWell: day?.dayWentWell ?? null,
      dayToImprove: day?.dayToImprove ?? null,
      dayMainLesson: day?.dayMainLesson ?? null,
      dayCarryForward: day?.dayCarryForward ?? null,
    },
    warnings,
  };
}

/** Autosave-friendly patch — same pattern as updateTodaysPlan (Stage §2). */
export async function saveDailyReflection(userId: string, dateKey: string, input: DailyReflectionInput): Promise<void> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: {
      ...("dayWentWell" in input ? { dayWentWell: input.dayWentWell ?? null } : {}),
      ...("dayToImprove" in input ? { dayToImprove: input.dayToImprove ?? null } : {}),
      ...("dayMainLesson" in input ? { dayMainLesson: input.dayMainLesson ?? null } : {}),
      ...("dayCarryForward" in input ? { dayCarryForward: input.dayCarryForward ?? null } : {}),
    },
  });
}

/**
 * The Close Trading Day action itself (Stage 8 §1/§6): save the reflection
 * (a last safety-net write — autosave should already have most of it),
 * reconcile every trade's legacy status/closedAt via the one authoritative
 * function (Stage 8 §4), then REUSE the existing endDay archive mechanism —
 * never a second archive path. A day may legitimately close with open
 * positions (PARTIALLY_CLOSED/STILL_HOLDING trades) — nothing here blocks
 * on that; getDayCloseSummary's warnings are informational only.
 */
export async function closeTradingDay(
  userId: string,
  dateKey: string,
  reflection: CloseTradingDayInput,
): Promise<TradingDay> {
  const day = await getOrCreateTradingDay(userId, dateKey);
  await prisma.tradingDay.update({
    where: { id: day.id },
    data: {
      ...("dayWentWell" in reflection ? { dayWentWell: reflection.dayWentWell ?? null } : {}),
      ...("dayToImprove" in reflection ? { dayToImprove: reflection.dayToImprove ?? null } : {}),
      ...("dayMainLesson" in reflection ? { dayMainLesson: reflection.dayMainLesson ?? null } : {}),
      ...("dayCarryForward" in reflection ? { dayCarryForward: reflection.dayCarryForward ?? null } : {}),
    },
  });

  const trades = await prisma.trade.findMany({ where: tradeWhereForDay(userId, dateKey), select: { id: true } });
  for (const trade of trades) {
    await reconcileTradeLifecycleForTrade(userId, trade.id);
  }

  return endDay(userId, dateKey);
}

// ── Journal calendar (Stage 9 §2/§19) ────────────────────────────────────────

export interface DailyPerformanceSummaryDTO {
  dateKey: string;
  /** Executed trades only — cancelled ideas are counted separately and never
   *  contribute to R/PnL/win-loss (Stage 8 §4/§11). */
  executedTradeCount: number;
  cancelledCount: number;
  totalRealizedR: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
}

/**
 * One batched read for the trader's ENTIRE trade history (same scale
 * assumption as trades.service.ts's listDailyPnl, which this calendar used to
 * consume) — a single Prisma query with the necessary nested includes, then
 * grouped by day in memory. Deliberately NOT one query per day (Stage 9 §19).
 */
export async function listDailyPerformanceSummaries(userId: string): Promise<DailyPerformanceSummaryDTO[]> {
  const trades = await prisma.trade.findMany({
    where: { userId },
    select: {
      tradeDate: true,
      direction: true,
      actualEntry: true,
      actualStopLoss: true,
      actualExit: true,
      actualRR: true,
      reviewLifecycleStatus: true,
      actualPartialExits: { select: { exitPrice: true, percentClosed: true } },
      performanceRiskSnapshot: { select: { initialStop: true, realizedR: true, performancePnl: true, settledAt: true } },
    },
  });

  const byDay = new Map<string, DailyPerformanceSummaryDTO>();
  const get = (dateKey: string) => {
    let entry = byDay.get(dateKey);
    if (!entry) {
      entry = { dateKey, executedTradeCount: 0, cancelledCount: 0, totalRealizedR: 0, totalPnl: 0, wins: 0, losses: 0, breakevens: 0 };
      byDay.set(dateKey, entry);
    }
    return entry;
  };

  for (const trade of trades) {
    const dateKey = utcDateToKey(trade.tradeDate);
    const entry = get(dateKey);

    if (trade.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED") {
      entry.cancelledCount++;
      continue;
    }
    if (trade.actualEntry == null) continue; // a pending/unstarted idea — no result yet either way

    entry.executedTradeCount++;
    const summary = computeTradeExecutionSummary({
      direction: trade.direction,
      actualEntry: trade.actualEntry.toString(),
      actualStopLoss: trade.actualStopLoss?.toString() ?? null,
      actualExit: trade.actualExit?.toString() ?? null,
      resolvedInitialStop: trade.performanceRiskSnapshot?.initialStop?.toString() ?? null,
      partials: trade.actualPartialExits.map((p) => ({
        exitPrice: p.exitPrice.toString(),
        percentClosed: p.percentClosed?.toString() ?? null,
      })),
      settled: trade.performanceRiskSnapshot?.settledAt != null,
      settledRealizedR: trade.performanceRiskSnapshot?.realizedR?.toString() ?? null,
      settledPnl: trade.performanceRiskSnapshot?.performancePnl?.toString() ?? null,
    });

    if (summary.realizedRSoFar != null) entry.totalRealizedR += summary.realizedRSoFar;
    if (summary.pnl != null) entry.totalPnl += summary.pnl;

    if (trade.reviewLifecycleStatus === "FULLY_CLOSED" && trade.actualRR != null) {
      const r = trade.actualRR.toNumber();
      if (r > 0.001) entry.wins++;
      else if (r < -0.001) entry.losses++;
      else entry.breakevens++;
    }
  }

  return Array.from(byDay.values());
}
