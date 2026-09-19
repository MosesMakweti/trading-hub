import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { buildCanonicalTradeRow, type CanonicalAnalyticsTradeRow } from "@/domain/analytics/canonical-dataset";
import {
  aggregateByAsset,
  aggregateByBehaviourLabel,
  aggregateByBiasAlignment,
  aggregateByDirection,
  aggregateByMonth,
  aggregateByMoodIntensity,
  aggregateByMoodTag,
  aggregateByOverrideReason,
  aggregateBySession,
  aggregateBySetupType,
  aggregateByStrategy,
  aggregateByValidationState,
  aggregateByWeekday,
  buildCumulativeRealizedRCurve,
  computeRGroupStats,
  distributionByRealizedR,
  summarizePlannedVsActual,
  toMetricInputs,
} from "@/domain/analytics/canonical-aggregations";
import * as metrics from "@/domain/performance/metrics";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";

/**
 * Analytics consolidation (Stage 10) — loads the canonical, R-primary trade
 * dataset with ONE batched Trade query (behaviour labels + partial exits +
 * the Performance snapshot come along as nested includes, not separate
 * per-trade round-trips — Stage 10 §20), maps every row through the pure
 * domain builder, then applies filters in memory. Every chart on the new
 * Analytics section reads from this SAME dataset — no widget queries the
 * Trade table on its own.
 */

export interface CanonicalAnalyticsFilters {
  /** Omit both `from`/`to` for an all-time dataset (Stage 10.5 — per-strategy
   *  performance and other non-range callers). */
  from?: string;
  to?: string;
  strategyId?: string;
  setupTypeName?: string;
  asset?: string;
  direction?: "LONG" | "SHORT";
  session?: string;
  validationState?: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN";
  behaviourLabel?: string;
  moodTag?: string;
}

const canonicalTradeInclude = {
  actualPartialExits: true,
  performanceRiskSnapshot: { select: { initialStop: true, realizedR: true, performancePnl: true, settledAt: true } },
  behaviourLabels: { include: { behaviourLabel: true } },
  psychology: { select: { psychologyPercent: true } },
} as const;

export async function getCanonicalAnalyticsDataset(
  userId: string,
  filters: CanonicalAnalyticsFilters,
): Promise<CanonicalAnalyticsTradeRow[]> {
  const tradeDate =
    filters.from != null || filters.to != null
      ? {
          ...(filters.from != null ? { gte: dateKeyToUtcDate(filters.from) } : {}),
          ...(filters.to != null ? { lte: dateKeyToUtcDate(filters.to) } : {}),
        }
      : undefined;

  const trades = await prisma.trade.findMany({
    where: { userId, ...(tradeDate ? { tradeDate } : {}) },
    include: canonicalTradeInclude,
    orderBy: [{ tradeDate: "asc" }, { executionMinutes: "asc" }],
  });

  const rows = trades.map((t) => {
    const setupSnapshot = t.setupValidationSnapshot as unknown as SetupValidationSnapshot | null;
    return buildCanonicalTradeRow({
      tradeId: t.id,
      dateKey: utcDateToKey(t.tradeDate),
      direction: t.direction,
      assetSymbol: t.assetSymbol,
      strategyId: t.strategyId,
      strategyName: t.strategyNameSnapshot,
      session: t.selectedSession,
      reviewLifecycleStatus: t.reviewLifecycleStatus,
      validationState: t.validationState,
      overrideReason: t.overrideReason,
      setupTypeName: setupSnapshot?.setupType.name ?? null,
      validationScore: setupSnapshot?.score ?? null,
      dailyBiasSnapshot: t.dailyBiasSnapshot as CanonicalAnalyticsTradeRow["dailyBiasSnapshot"],
      plannedR: t.expectedRR?.toNumber() ?? null,
      actualRR: t.actualRR?.toNumber() ?? null,
      actualEntry: t.actualEntry?.toNumber() ?? null,
      actualStopLoss: t.actualStopLoss?.toNumber() ?? null,
      actualExit: t.actualExit?.toNumber() ?? null,
      resolvedInitialStop: t.performanceRiskSnapshot?.initialStop?.toNumber() ?? null,
      partials: t.actualPartialExits.map((p) => ({
        exitPrice: p.exitPrice.toNumber(),
        percentClosed: p.percentClosed?.toNumber() ?? null,
      })),
      settled: t.performanceRiskSnapshot?.settledAt != null,
      settledRealizedR: t.performanceRiskSnapshot?.realizedR?.toNumber() ?? null,
      settledPnl: t.performanceRiskSnapshot?.performancePnl?.toNumber() ?? null,
      preTradeMoodTags: t.preTradeMoodTags,
      moodIntensity: t.preTradeMoodIntensity,
      behaviourLabels: t.behaviourLabels
        .filter((l) => l.behaviourLabel.deletedAt == null)
        .map((l) => ({ name: l.behaviourLabel.name, polarity: l.behaviourLabel.polarity })),
      adherencePercent: t.adherencePercent,
      confluencePercent: t.confluencePercent,
      executionPercent: t.executionPercent,
      tradeQualityPercent: t.tradeQualityPercent,
      psychologyPercent: t.psychology?.psychologyPercent ?? null,
    });
  });

  return rows.filter(
    (r) =>
      (!filters.strategyId || r.strategyId === filters.strategyId) &&
      (!filters.setupTypeName || r.setupTypeName === filters.setupTypeName) &&
      (!filters.asset || r.assetSymbol === filters.asset) &&
      (!filters.direction || r.direction === filters.direction) &&
      (!filters.session || r.session === filters.session) &&
      (!filters.validationState || r.validationState === filters.validationState) &&
      (!filters.behaviourLabel || r.behaviourLabels.some((l) => l.name === filters.behaviourLabel)) &&
      (!filters.moodTag || r.preTradeMoodTags.includes(filters.moodTag)),
  );
}

export interface CanonicalFilterOptionsDTO {
  setupTypes: string[];
  behaviourLabels: string[];
  moodTags: string[];
}

/** Distinct filter values Stage 4-5-7 have produced — additive to
 *  analytics.service.ts's getAnalyticsFilterOptions (strategy/asset/session/
 *  entry model), which stays as the single place the filter bar reads from. */
export async function getCanonicalFilterOptions(userId: string): Promise<CanonicalFilterOptionsDTO> {
  const [setupTypes, behaviourLabels, moodRows] = await Promise.all([
    prisma.strategySetupType.findMany({ where: { userId, deletedAt: null }, select: { name: true }, distinct: ["name"] }),
    prisma.behaviourLabel.findMany({ where: { userId, deletedAt: null }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.trade.findMany({ where: { userId }, select: { preTradeMoodTags: true } }),
  ]);
  const moodTags = [...new Set(moodRows.flatMap((r) => r.preTradeMoodTags))].sort();
  return {
    setupTypes: setupTypes.map((s) => s.name).sort(),
    behaviourLabels: behaviourLabels.map((l) => l.name),
    moodTags,
  };
}

export interface CanonicalAnalyticsSummary {
  overview: {
    totalExecutedTrades: number;
    finalizedTrades: number;
    /** Analytics V2 §2/§3 — executed but not yet Performance-settled
     *  (totalExecutedTrades − finalizedTrades). Outcome not yet finalized;
     *  never counted toward win rate/profit factor/expectancy/streaks. */
    pendingTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    totalRealizedR: number;
    totalPnl: number;
    winRate: number | null;
    expectancy: number | null;
    profitFactor: number | null;
    averageWinnerR: number | null;
    averageLoserR: number | null;
    /** Analytics V2 §3 — best/worst SETTLED result (R-multiple); null with
     *  no settled sample yet, never 0. */
    bestTradeR: number | null;
    worstTradeR: number | null;
    overrideCount: number;
    overrideRate: number | null;
    cancelledCount: number;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  cumulativeRCurve: ReturnType<typeof buildCumulativeRealizedRCurve>;
  rDistribution: ReturnType<typeof distributionByRealizedR>;
  byWeekday: ReturnType<typeof aggregateByWeekday>;
  byMonth: ReturnType<typeof aggregateByMonth>;
  byStrategy: ReturnType<typeof aggregateByStrategy>;
  bySetupType: ReturnType<typeof aggregateBySetupType>;
  byAsset: ReturnType<typeof aggregateByAsset>;
  byDirection: ReturnType<typeof aggregateByDirection>;
  bySession: ReturnType<typeof aggregateBySession>;
  byValidationState: ReturnType<typeof aggregateByValidationState>;
  byOverrideReason: ReturnType<typeof aggregateByOverrideReason>;
  byBiasAlignment: ReturnType<typeof aggregateByBiasAlignment>;
  byBehaviourLabel: ReturnType<typeof aggregateByBehaviourLabel>;
  byMoodTag: ReturnType<typeof aggregateByMoodTag>;
  byMoodIntensity: ReturnType<typeof aggregateByMoodIntensity>;
  plannedVsActual: ReturnType<typeof summarizePlannedVsActual>;
}

/** Runs every pure aggregator once over the same dataset (Stage 10 §20) —
 *  the page calls this once; components only render the result. */
export function summarizeCanonicalAnalytics(rows: CanonicalAnalyticsTradeRow[]): CanonicalAnalyticsSummary {
  const overall = computeRGroupStats("all", "All", rows);
  const executed = rows.filter((r) => r.isExecuted);
  // Analytics V2 — finalizedR is already gated on the canonical
  // Performance-settled fact (canonical-dataset.ts); reviewLifecycleStatus
  // is an independent, manual trader confirmation and must not additionally
  // gate the settled sample here (see canonical-aggregations.ts's
  // toMetricInputs for the same fix).
  const finalized = executed.filter((r) => r.finalizedR != null);
  const winners = finalized.filter((r) => r.finalizedR! > 0);
  const losers = finalized.filter((r) => r.finalizedR! < 0);
  const overrideCount = executed.filter((r) => r.validationState === "OVERRIDDEN").length;
  const validatedOrOverridden = executed.filter((r) => r.validationState === "VALIDATED" || r.validationState === "OVERRIDDEN");

  return {
    overview: {
      totalExecutedTrades: overall.count,
      finalizedTrades: overall.finalizedCount,
      pendingTrades: overall.count - overall.finalizedCount,
      winningTrades: winners.length,
      losingTrades: losers.length,
      breakevenTrades: finalized.length - winners.length - losers.length,
      totalRealizedR: overall.totalR,
      totalPnl: overall.totalPnl,
      winRate: overall.winRate,
      expectancy: overall.expectancy,
      profitFactor: overall.profitFactor,
      averageWinnerR: winners.length > 0 ? winners.reduce((s, r) => s + r.finalizedR!, 0) / winners.length : null,
      averageLoserR: losers.length > 0 ? losers.reduce((s, r) => s + r.finalizedR!, 0) / losers.length : null,
      bestTradeR: finalized.length > 0 ? Math.max(...finalized.map((r) => r.finalizedR!)) : null,
      worstTradeR: finalized.length > 0 ? Math.min(...finalized.map((r) => r.finalizedR!)) : null,
      overrideCount,
      overrideRate: validatedOrOverridden.length > 0 ? (overrideCount / validatedOrOverridden.length) * 100 : null,
      cancelledCount: rows.filter((r) => r.isCancelled).length,
      longestWinStreak: metrics.longestWinStreak(toMetricInputs(executed)),
      longestLossStreak: metrics.longestLossStreak(toMetricInputs(executed)),
    },
    cumulativeRCurve: buildCumulativeRealizedRCurve(rows),
    rDistribution: distributionByRealizedR(rows),
    byWeekday: aggregateByWeekday(rows),
    byMonth: aggregateByMonth(rows),
    byStrategy: aggregateByStrategy(rows),
    bySetupType: aggregateBySetupType(rows),
    byAsset: aggregateByAsset(rows),
    byDirection: aggregateByDirection(rows),
    bySession: aggregateBySession(rows),
    byValidationState: aggregateByValidationState(rows),
    byOverrideReason: aggregateByOverrideReason(rows),
    byBiasAlignment: aggregateByBiasAlignment(rows),
    byBehaviourLabel: aggregateByBehaviourLabel(rows),
    byMoodTag: aggregateByMoodTag(rows),
    byMoodIntensity: aggregateByMoodIntensity(rows),
    plannedVsActual: summarizePlannedVsActual(rows),
  };
}
