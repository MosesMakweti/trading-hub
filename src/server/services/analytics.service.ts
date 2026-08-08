import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { daysBetweenInclusive } from "@/lib/date-ranges";
import { buildEquityCurve, dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import * as metrics from "@/domain/performance/metrics";
import {
  summarizeAdherence,
  type AdherenceTradePoint,
} from "@/domain/performance/adherence-analytics";
import {
  buildDiscrepancyCurve,
  compositeExecutionScore,
  summarizeDiscrepancy,
  type ExecutionTradeInput,
} from "@/domain/analytics/execution-engine";
import {
  aggregateDeviationCauses,
  computeDeviations,
  type Deviation,
} from "@/domain/analytics/deviation-engine";
import {
  summarizeStrategyPerformance,
  type StrategyTradePoint,
} from "@/domain/performance/strategy-performance";
import * as psychAnalytics from "@/domain/psychology/analytics";
import type { PsychologyDataPoint } from "@/domain/psychology/analytics";
import {
  getOrCreatePerformanceAccount,
  PERFORMANCE_ACCOUNT_STARTING_BALANCE,
} from "@/server/services/accounts.service";

/**
 * Every number returned here is derived from the Performance Account's real
 * dollar track record — the app's single source of truth for analytics (see
 * accounts.service.ts). Nothing here reads `Trade.actualRR` (the trader's
 * separate, optional self-reported R-multiple); a trade's "contribution %"
 * is always `performancePnl / balanceBeforeThatTrade * 100`.
 */
/**
 * Performance for a single strategy (win-rate / RR / psychology / adherence by
 * strategy). Uses the same Performance Account contribution % as the global
 * analytics: it walks the full allocation history to get each trade's balance-
 * before contribution, then keeps only the trades linked to this strategy. All
 * numbers are therefore computed identically to the rest of the app.
 */
/**
 * Day-scoped analytics for the Today workspace's Daily Analytics section. Same
 * Performance Account contribution % as everywhere else (walk the full allocation
 * history for balance-before, keep only the day's trades), summarised by the
 * shared `summarizeStrategyPerformance`, plus the day's net PnL in dollars.
 */
export async function getDailyAnalytics(userId: string, dateKey: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const allocations = await prisma.tradeAccountAllocation.findMany({
    where: { tradingAccountId: performanceAccount.id, trade: { deletedAt: null } },
    include: {
      trade: {
        select: {
          tradeDate: true,
          adherencePercent: true,
          assetSymbol: true,
          psychology: { select: { psychologyPercent: true } },
        },
      },
    },
    orderBy: [{ trade: { tradeDate: "asc" } }, { trade: { executionMinutes: "asc" } }],
  });

  let runningBalance = PERFORMANCE_ACCOUNT_STARTING_BALANCE;
  const points: StrategyTradePoint[] = [];
  let netPnl = 0;
  for (const alloc of allocations) {
    const t = alloc.trade;
    const pnl = alloc.closingPnlNet.toNumber();
    const contributionPercent = runningBalance !== 0 ? (pnl / runningBalance) * 100 : 0;
    runningBalance += pnl;
    if (utcDateToKey(t.tradeDate) === dateKey) {
      points.push({
        dateKey,
        assetSymbol: t.assetSymbol,
        actualRR: contributionPercent,
        psychologyPercent: t.psychology?.psychologyPercent ?? null,
        adherencePercent: t.adherencePercent,
      });
      netPnl += pnl;
    }
  }

  return { ...summarizeStrategyPerformance(points), netPnl };
}

export async function getStrategyPerformance(userId: string, strategyId: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const allocations = await prisma.tradeAccountAllocation.findMany({
    where: { tradingAccountId: performanceAccount.id, trade: { deletedAt: null } },
    include: {
      trade: {
        select: {
          strategyId: true,
          tradeDate: true,
          adherencePercent: true,
          assetSymbol: true,
          psychology: { select: { psychologyPercent: true } },
        },
      },
    },
    orderBy: [{ trade: { tradeDate: "asc" } }, { trade: { executionMinutes: "asc" } }],
  });

  let runningBalance = PERFORMANCE_ACCOUNT_STARTING_BALANCE;
  const points: StrategyTradePoint[] = [];
  for (const alloc of allocations) {
    const t = alloc.trade;
    const pnl = alloc.closingPnlNet.toNumber();
    const contributionPercent = runningBalance !== 0 ? (pnl / runningBalance) * 100 : 0;
    runningBalance += pnl;
    if (t.strategyId === strategyId) {
      points.push({
        dateKey: utcDateToKey(t.tradeDate),
        assetSymbol: t.assetSymbol,
        actualRR: contributionPercent,
        psychologyPercent: t.psychology?.psychologyPercent ?? null,
        adherencePercent: t.adherencePercent,
      });
    }
  }

  return summarizeStrategyPerformance(points);
}

export async function getAnalyticsData(userId: string, from: string, to: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const allPerformanceAllocations = await prisma.tradeAccountAllocation.findMany({
    where: { tradingAccountId: performanceAccount.id, trade: { deletedAt: null } },
    include: {
      trade: {
        include: {
          psychology: true,
          allocations: { include: { tradingAccount: true } },
          // The strategy's live benchmark (proven edge) + risk budget → Discrepancy Gap.
          strategy: {
            select: { tradeManagement: { select: { expectedExpectancy: true, maxRiskPercent: true } } },
          },
        },
      },
    },
    orderBy: [{ trade: { tradeDate: "asc" } }, { trade: { executionMinutes: "asc" } }],
  });

  const fromDate = dateKeyToUtcDate(from);
  const toDate = dateKeyToUtcDate(to);

  // Balance carries forward from all-time history so a filtered range (e.g.
  // "This Month") still reflects the account's true balance at that point,
  // not a naive reset to the $100k baseline.
  let balanceBeforeRange = PERFORMANCE_ACCOUNT_STARTING_BALANCE;
  const inRange: typeof allPerformanceAllocations = [];
  for (const alloc of allPerformanceAllocations) {
    const tradeDate = alloc.trade.tradeDate;
    if (tradeDate < fromDate) {
      balanceBeforeRange += alloc.closingPnlNet.toNumber();
    } else if (tradeDate <= toDate) {
      inRange.push(alloc);
    }
  }

  // SOT: rule adherence is now the strategy-execution adherence frozen on the
  // trade (selected vs the strategy's expected execution set) — no longer derived
  // from the removed global checklist. Null for pre-SOT trades (excluded from avgs).
  function ruleAdherenceForTrade(t: (typeof inRange)[number]["trade"]): number | null {
    return t.executionPercent;
  }

  let runningBalance = balanceBeforeRange;
  const tradeInputs: metrics.TradeMetricInput[] = [];
  const psychologyPoints: PsychologyDataPoint[] = [];
  const adherencePoints: AdherenceTradePoint[] = [];
  const discrepancyInputs: ExecutionTradeInput[] = [];
  const deviationPrimaries: (Deviation | null)[] = [];
  const dailyPnlMap = new Map<string, number>();

  for (const alloc of inRange) {
    const t = alloc.trade;
    const dateKey = utcDateToKey(t.tradeDate);
    const pnl = alloc.closingPnlNet.toNumber();
    const contributionPercent = runningBalance !== 0 ? (pnl / runningBalance) * 100 : 0;
    runningBalance += pnl;

    const strategyLabel = t.strategyNameSnapshot
      ? t.strategyVersionSnapshot != null
        ? `${t.strategyNameSnapshot} · v${t.strategyVersionSnapshot}`
        : t.strategyNameSnapshot
      : null;
    tradeInputs.push({
      dateKey,
      assetSymbol: t.assetSymbol,
      actualRR: contributionPercent,
      strategyLabel,
    });
    dailyPnlMap.set(dateKey, (dailyPnlMap.get(dateKey) ?? 0) + pnl);

    adherencePoints.push({
      win: pnl > 0 ? true : pnl < 0 ? false : null,
      dateKey,
      confluences: (t.selectedConfluences as string[] | null) ?? [],
      confluencePercent: t.confluencePercent,
      executionPercent: t.executionPercent,
      tradeQualityPercent: t.tradeQualityPercent,
      setupScore: t.setupScore,
      setupRating: t.setupRating as (typeof adherencePoints)[number]["setupRating"],
    });

    // Discrepancy Gap: expected R = strategy expectancy × execution quality vs the
    // trade's realized R (self-reported actualRR). Execution score is the frozen
    // composite (trade quality → setup → confluence adherence).
    discrepancyInputs.push({
      tradeNumber: t.tradeNumber ?? 0,
      dateKey,
      strategyExpectancyR: t.strategy?.tradeManagement?.expectedExpectancy ?? null,
      executionScore: compositeExecutionScore(t),
      actualR: t.actualRR ? t.actualRR.toNumber() : null,
    });

    // Deviation engine: WHY did actual differ from plan? (entry/exit/risk slip).
    const { primary } = computeDeviations({
      direction: t.direction,
      plannedEntry: t.plannedEntry ? t.plannedEntry.toNumber() : null,
      plannedStopLoss: t.plannedStopLoss ? t.plannedStopLoss.toNumber() : null,
      plannedTarget: t.plannedTarget ? t.plannedTarget.toNumber() : null,
      actualEntry: t.actualEntry ? t.actualEntry.toNumber() : null,
      actualExit: t.actualExit ? t.actualExit.toNumber() : null,
      actualRR: t.actualRR ? t.actualRR.toNumber() : null,
      plannedRiskPercent: t.strategy?.tradeManagement?.maxRiskPercent
        ? t.strategy.tradeManagement.maxRiskPercent.toNumber()
        : null,
      actualRiskPercent: alloc.riskInputType === "PERCENT" ? alloc.riskValue.toNumber() : null,
    });
    deviationPrimaries.push(primary);

    if (t.psychology) {
      const otherAccount = t.allocations.find((a) => a.tradingAccount.kind !== "PERFORMANCE");
      psychologyPoints.push({
        dateKey,
        percent: t.psychology.psychologyPercent,
        rawScore: t.psychology.rawScore,
        assetSymbol: t.assetSymbol,
        accountName: otherAccount?.tradingAccount.name ?? "Performance Account",
        sessionName: t.selectedSession ?? null,
        actualRR: contributionPercent,
        ruleAdherencePercent: ruleAdherenceForTrade(t),
      });
    }
  }

  const dailyPercents = dailyPercentsFromBalanceHistory(
    balanceBeforeRange,
    Array.from(dailyPnlMap.entries()).map(([dateKey, pnl]) => ({ dateKey, pnl })),
  );

  const ruleAdherenceValues = inRange
    .map((a) => ruleAdherenceForTrade(a.trade))
    .filter((v): v is number => v !== null);
  const ruleAdherenceAverage =
    ruleAdherenceValues.length > 0
      ? ruleAdherenceValues.reduce((s, v) => s + v, 0) / ruleAdherenceValues.length
      : null;

  const rangeDays = daysBetweenInclusive(from, to);
  const winningCount = tradeInputs.filter((t) => (t.actualRR ?? 0) > 0).length;
  const losingCount = tradeInputs.filter((t) => (t.actualRR ?? 0) < 0).length;

  // Discrepancy Gap — Expected vs Actual equity, via the central Execution Engine.
  const discrepancy = {
    curve: buildDiscrepancyCurve(discrepancyInputs),
    summary: summarizeDiscrepancy(discrepancyInputs),
    // Behavioural causes of the gap (Psychology Lab): per-cause occurrences + R-cost.
    causes: aggregateDeviationCauses(deviationPrimaries),
  };

  return {
    trading: {
      totalTrades: tradeInputs.length,
      closedTrades: tradeInputs.length,
      winningTrades: winningCount,
      losingTrades: losingCount,
      winRate: metrics.winRate(tradeInputs),
      averageRR: metrics.averageRR(tradeInputs),
      profitFactor: metrics.profitFactor(tradeInputs),
      expectancy: metrics.expectancy(tradeInputs),
      averageWinner: metrics.averageWinner(tradeInputs),
      averageLoser: metrics.averageLoser(tradeInputs),
      longestWinStreak: metrics.longestWinStreak(tradeInputs),
      longestLossStreak: metrics.longestLossStreak(tradeInputs),
      mostTradedAsset: metrics.mostTradedAsset(tradeInputs),
      averageTradesPerDay: metrics.averageTradesPerDay(tradeInputs, rangeDays),
      ruleAdherenceAverage,
      statsByAsset: metrics.statsByAsset(tradeInputs),
      statsByStrategy: metrics.statsByStrategy(tradeInputs),
      monthlyReturns: metrics.monthlyReturns(dailyPercents),
      equityCurve: buildEquityCurve(dailyPercents),
      discrepancy,
      dailyPercents,
      // SOT strategy-adherence analytics (foundation): average confluence / execution /
      // trade-quality adherence, avg confluence count on winners vs losers, and a
      // per-confluence win-rate leaderboard. Built from each trade's frozen scores.
      adherence: summarizeAdherence(adherencePoints),
    },
    psychology: {
      averagePercent: psychAnalytics.averagePsychologyPercent(psychologyPoints),
      averageScore: psychAnalytics.averagePsychologyScore(psychologyPoints),
      averageGrade: psychAnalytics.averagePsychologyGrade(psychologyPoints),
      trendByMonth: psychAnalytics.trendByMonth(psychologyPoints),
      trendByWeek: psychAnalytics.trendByWeek(psychologyPoints),
      bestMonth: psychAnalytics.bestMonth(psychologyPoints),
      worstMonth: psychAnalytics.worstMonth(psychologyPoints),
      byAsset: psychAnalytics.byAsset(psychologyPoints),
      byAccount: psychAnalytics.byAccount(psychologyPoints),
      bySession: psychAnalytics.bySession(psychologyPoints),
      byDayOfWeek: psychAnalytics.byDayOfWeek(psychologyPoints),
      byDay: psychAnalytics.byDay(psychologyPoints),
      correlationWithWinRate: psychAnalytics.correlationWithWinRate(psychologyPoints),
      correlationWithProfitability: psychAnalytics.correlationWithProfitability(psychologyPoints),
      correlationWithRuleAdherence: psychAnalytics.correlationWithRuleAdherence(psychologyPoints),
      dataPoints: psychologyPoints,
    },
  };
}
