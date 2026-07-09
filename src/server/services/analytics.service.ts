import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { daysBetweenInclusive } from "@/lib/date-ranges";
import { buildEquityCurve, dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import * as metrics from "@/domain/performance/metrics";
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
export async function getAnalyticsData(userId: string, from: string, to: string) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const [allPerformanceAllocations, executionItemCount] = await Promise.all([
    prisma.tradeAccountAllocation.findMany({
      where: { tradingAccountId: performanceAccount.id, trade: { deletedAt: null } },
      include: {
        trade: {
          include: {
            asset: true,
            session: true,
            checklistSelections: { include: { checklistItem: true } },
            psychology: true,
            allocations: { include: { tradingAccount: true } },
          },
        },
      },
      orderBy: [{ trade: { tradeDate: "asc" } }, { trade: { executionMinutes: "asc" } }],
    }),
    prisma.checklistItemDefinition.count({
      where: { userId, type: "EXECUTION_CONFIRMATION" },
    }),
  ]);

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

  function ruleAdherenceForTrade(t: (typeof inRange)[number]["trade"]): number | null {
    if (executionItemCount === 0) return null;
    const checked = t.checklistSelections.filter(
      (c) => c.checklistItem.type === "EXECUTION_CONFIRMATION",
    ).length;
    return (checked / executionItemCount) * 100;
  }

  let runningBalance = balanceBeforeRange;
  const tradeInputs: metrics.TradeMetricInput[] = [];
  const psychologyPoints: PsychologyDataPoint[] = [];
  const dailyPnlMap = new Map<string, number>();

  for (const alloc of inRange) {
    const t = alloc.trade;
    const dateKey = utcDateToKey(t.tradeDate);
    const pnl = alloc.closingPnlNet.toNumber();
    const contributionPercent = runningBalance !== 0 ? (pnl / runningBalance) * 100 : 0;
    runningBalance += pnl;

    tradeInputs.push({ dateKey, assetSymbol: t.asset.symbol, actualRR: contributionPercent });
    dailyPnlMap.set(dateKey, (dailyPnlMap.get(dateKey) ?? 0) + pnl);

    if (t.psychology) {
      const otherAccount = t.allocations.find((a) => a.tradingAccount.kind !== "PERFORMANCE");
      psychologyPoints.push({
        dateKey,
        percent: t.psychology.psychologyPercent,
        rawScore: t.psychology.rawScore,
        assetSymbol: t.asset.symbol,
        accountName: otherAccount?.tradingAccount.name ?? "Performance Account",
        sessionName: t.session?.name ?? null,
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
      monthlyReturns: metrics.monthlyReturns(dailyPercents),
      equityCurve: buildEquityCurve(dailyPercents),
      dailyPercents,
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
