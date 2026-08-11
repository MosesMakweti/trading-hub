import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { daysBetweenInclusive } from "@/lib/date-ranges";
import { buildEquityCurve, dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import * as metrics from "@/domain/performance/metrics";
import { maxDrawdown, pnlStats, recoveryFactor } from "@/domain/performance/pnl-stats";
import {
  dayOfWeekPerformance,
  hourPerformance,
  longShortPerformance,
  monthlyPerformance,
  rMultipleDistribution,
  riskStats,
  sessionPerformance,
  type AnalyticsTradePoint,
} from "@/domain/performance/breakdowns";
import {
  summarizeAdherence,
  type AdherenceTradePoint,
} from "@/domain/performance/adherence-analytics";
import {
  buildDiscrepancyCurve,
  classifyTrade,
  summarizeDiscrepancy,
  type DiscrepancyTradeInput,
} from "@/domain/analytics/discrepancy-model";
import {
  buildCounterfactualCurve,
  summarizeAttribution,
  type CounterfactualInput,
} from "@/domain/analytics/counterfactual-engine";
import { computeExpectancy, resolveExpectancy } from "@/domain/performance/expectancy";
import {
  aggregateDeviationCauses,
  computeDeviations,
  type Deviation,
} from "@/domain/analytics/deviation-engine";
import {
  buildOpportunityCurve,
  summarizeOpportunities,
} from "@/domain/analytics/opportunity-engine";
import {
  getMissReasonAggregate,
  getOpportunityInputs,
} from "@/server/services/opportunity.service";
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

/**
 * LIVE statistical expectancy for one strategy, computed from its own qualifying
 * realized R (self-reported actualRR) — the honest benchmark for Expected Statistical
 * Equity, and what Strategy Lab shows as "Live" alongside the user's backtested
 * numbers. `sufficient` is false below MIN_EXPECTANCY_SAMPLE; callers must not treat
 * an insufficient sample as a proven edge.
 */
export async function getStrategyExpectancy(userId: string, strategyId: string) {
  const trades = await prisma.trade.findMany({
    where: { userId, strategyId, actualRR: { not: null } },
    select: { actualRR: true },
  });
  const rs = trades.map((t) => (t.actualRR ? t.actualRR.toNumber() : 0));
  return computeExpectancy(rs);
}

/**
 * Optional analytics filters. Date range stays a separate (from/to) argument; these
 * narrow WHICH trades are aggregated. The account balance is still walked over ALL
 * in-range trades (so each included trade's contribution % is account-correct) —
 * only the aggregation is filtered. Absent filters = unchanged behavior.
 */
export interface AnalyticsFilters {
  strategyId?: string;
  entryModel?: string;
  asset?: string;
  direction?: "LONG" | "SHORT";
  session?: string;
  accountId?: string;
  status?: "OPEN" | "CLOSED" | "REVIEWED";
  winLoss?: "win" | "loss";
}

export interface AnalyticsFilterOptions {
  strategies: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  assets: string[];
  sessions: string[];
  entryModels: string[];
}

/** Distinct values the Analytics filter bar offers — from the user's own data. */
export async function getAnalyticsFilterOptions(userId: string): Promise<AnalyticsFilterOptions> {
  const [trades, strategies, accounts] = await Promise.all([
    prisma.trade.findMany({
      where: { userId },
      select: { assetSymbol: true, selectedSession: true, selectedEntryModel: true },
    }),
    prisma.strategy.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tradingAccount.findMany({
      where: { userId, kind: { not: "PERFORMANCE" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const uniqSorted = (xs: (string | null)[]) =>
    [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
  return {
    strategies,
    accounts,
    assets: uniqSorted(trades.map((t) => t.assetSymbol)),
    sessions: uniqSorted(trades.map((t) => t.selectedSession)),
    entryModels: uniqSorted(trades.map((t) => t.selectedEntryModel)),
  };
}

export async function getAnalyticsData(
  userId: string,
  from: string,
  to: string,
  filters?: AnalyticsFilters,
) {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);

  const allPerformanceAllocations = await prisma.tradeAccountAllocation.findMany({
    where: { tradingAccountId: performanceAccount.id, trade: { deletedAt: null } },
    include: {
      trade: {
        include: {
          psychology: true,
          allocations: { include: { tradingAccount: true } },
          // The strategy's live benchmark (proven edge) + risk budget + counterfactual
          // day-limits → Discrepancy Gap.
          strategy: {
            select: {
              tradeManagement: {
                select: {
                  expectedExpectancy: true,
                  maxRiskPercent: true,
                  maxDailyRiskPercent: true,
                  maxTradesPerDay: true,
                },
              },
            },
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

  // Per-strategy statistical expectancy for the Expected Statistical Equity line
  // (System A of the corrected discrepancy model). Computed LIVE from each strategy's
  // own qualifying realized R over ALL-TIME history; when the sample is too small it
  // falls back to the user's backtested number, else the trade is unbenchmarked
  // (INSUFFICIENT_SAMPLE — no fabricated benchmark). NOT the planned target RR.
  const strategyRs = new Map<string, number[]>();
  const strategyBacktest = new Map<string, number | null>();
  for (const alloc of allPerformanceAllocations) {
    const t = alloc.trade;
    if (!t.strategyId) continue;
    strategyBacktest.set(t.strategyId, t.strategy?.tradeManagement?.expectedExpectancy ?? null);
    if (t.actualRR != null) {
      const arr = strategyRs.get(t.strategyId) ?? [];
      arr.push(t.actualRR.toNumber());
      strategyRs.set(t.strategyId, arr);
    }
  }
  const resolvedExpectancy = new Map<string, number | null>();
  for (const [sid, backtest] of strategyBacktest) {
    resolvedExpectancy.set(sid, resolveExpectancy(computeExpectancy(strategyRs.get(sid) ?? []), backtest).expectancyR);
  }

  // SOT: rule adherence is now the strategy-execution adherence frozen on the
  // trade (selected vs the strategy's expected execution set) — no longer derived
  // from the removed global checklist. Null for pre-SOT trades (excluded from avgs).
  function ruleAdherenceForTrade(t: (typeof inRange)[number]["trade"]): number | null {
    return t.executionPercent;
  }

  let runningBalance = balanceBeforeRange;
  // Filtered equity — advances only for included trades (drawdown of the subset).
  let filteredBalance = balanceBeforeRange;
  const tradeInputs: metrics.TradeMetricInput[] = [];
  const psychologyPoints: PsychologyDataPoint[] = [];
  const adherencePoints: AdherenceTradePoint[] = [];
  const correctedInputs: DiscrepancyTradeInput[] = [];
  const deviationPrimaries: (Deviation | null)[] = [];
  const dailyPnlMap = new Map<string, number>();
  // $ P&L per trade + the running-balance series, for the dollar summary and
  // drawdown (Analytics module). Same allocations as everything else — no new query.
  const tradePnls: number[] = [];
  const balanceSeries: number[] = [balanceBeforeRange];
  // Per-trade points for the Phase B breakdowns (day-of-week / month / direction /
  // session / hour / risk) — built from the same rows, not a second data source.
  const analyticsPoints: AnalyticsTradePoint[] = [];

  // Day-level aggregates (over ALL in-range trades — a day's over-risk / overtrading
  // is real regardless of the active filters) for the counterfactual's day flags.
  const dayRisk = new Map<string, number>();
  const dayCount = new Map<string, number>();
  for (const a of inRange) {
    const dk = utcDateToKey(a.trade.tradeDate);
    dayCount.set(dk, (dayCount.get(dk) ?? 0) + 1);
    if (a.riskInputType === "PERCENT") {
      dayRisk.set(dk, (dayRisk.get(dk) ?? 0) + a.riskValue.toNumber());
    }
  }

  // Counterfactual (Process-Perfect) events, collected with a chronological key so
  // executed trades and missed opportunities interleave correctly before the curve.
  const cfEvents: { chronoKey: number; input: CounterfactualInput }[] = [];

  for (const alloc of inRange) {
    const t = alloc.trade;
    const dateKey = utcDateToKey(t.tradeDate);
    const pnl = alloc.closingPnlNet.toNumber();
    const contributionPercent = runningBalance !== 0 ? (pnl / runningBalance) * 100 : 0;
    runningBalance += pnl; // true account balance — always advances (all in-range trades)

    // Aggregate only trades matching the active filters. The balance already
    // advanced above, so a filtered-out trade still counts toward later trades'
    // account-relative contribution %, but never enters the analytics.
    const included =
      (!filters?.strategyId || t.strategyId === filters.strategyId) &&
      (!filters?.entryModel || t.selectedEntryModel === filters.entryModel) &&
      (!filters?.asset || t.assetSymbol === filters.asset) &&
      (!filters?.direction || t.direction === filters.direction) &&
      (!filters?.session || (t.selectedSession ?? "") === filters.session) &&
      (!filters?.status || t.status === filters.status) &&
      (!filters?.accountId || t.allocations.some((a) => a.tradingAccountId === filters.accountId)) &&
      (!filters?.winLoss || (filters.winLoss === "win" ? pnl > 0 : pnl < 0));
    if (!included) continue;

    filteredBalance += pnl;
    tradePnls.push(pnl);
    balanceSeries.push(filteredBalance);
    analyticsPoints.push({
      dateKey,
      monthKey: dateKey.slice(0, 7),
      weekday: t.tradeDate.getUTCDay(),
      hour: Math.floor(t.executionMinutes / 60),
      pnl,
      actualR: contributionPercent,
      direction: t.direction,
      session: t.selectedSession ?? null,
      riskPercent: alloc.riskInputType === "PERCENT" ? alloc.riskValue.toNumber() : null,
    });

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

    // Deviation engine: the OBJECTIVE trader-controlled R-costs (entry/exit/risk
    // slip). This — NOT expected−actual — is the avoidable discrepancy.
    const tradeActualR = t.actualRR ? t.actualRR.toNumber() : null;
    const { deviations, primary } = computeDeviations({
      direction: t.direction,
      plannedEntry: t.plannedEntry ? t.plannedEntry.toNumber() : null,
      plannedStopLoss: t.plannedStopLoss ? t.plannedStopLoss.toNumber() : null,
      plannedTarget: t.plannedTarget ? t.plannedTarget.toNumber() : null,
      actualEntry: t.actualEntry ? t.actualEntry.toNumber() : null,
      actualExit: t.actualExit ? t.actualExit.toNumber() : null,
      actualRR: tradeActualR,
      plannedRiskPercent: t.strategy?.tradeManagement?.maxRiskPercent
        ? t.strategy.tradeManagement.maxRiskPercent.toNumber()
        : null,
      actualRiskPercent: alloc.riskInputType === "PERCENT" ? alloc.riskValue.toNumber() : null,
    });
    deviationPrimaries.push(primary);

    // Corrected discrepancy input: Expected Statistical R = the strategy's resolved
    // expectancy (System A); avoidable R = objective deviations only. A correctly
    // executed trade contributes 0 avoidable R whether it won or lost.
    const proc = classifyTrade({
      actualR: tradeActualR,
      deviations,
      adherenceFollowed: t.setupValid, // true = followed, false = invalid setup taken, null = no strategy
      hasExecutionData: t.plannedEntry != null && t.actualEntry != null,
    });
    correctedInputs.push({
      sequence: t.tradeNumber ?? correctedInputs.length + 1,
      dateKey,
      strategyExpectancyR: t.strategyId ? (resolvedExpectancy.get(t.strategyId) ?? null) : null,
      actualR: tradeActualR,
      avoidableR: proc.avoidableR,
    });

    // Counterfactual (Process-Perfect) executed event — reuses the same deviations.
    const dailyRiskLimit = t.strategy?.tradeManagement?.maxDailyRiskPercent ?? null;
    const maxPerDay = t.strategy?.tradeManagement?.maxTradesPerDay ?? null;
    cfEvents.push({
      chronoKey: t.tradeDate.getTime() + (t.executionMinutes ?? 0) * 60000,
      input: {
        kind: "EXECUTED",
        eventId: t.id,
        sequence: 0, // reassigned after the chronological merge below
        dateKey,
        actualR: tradeActualR,
        validSetup: t.setupValid,
        missingConfluences: (t.missingConfluences as string[] | null) ?? [],
        deviations,
        wouldTakeAgain: t.wouldTakeAgain,
        behaviorTag: t.tradeIntent,
        psychologyPercent: t.psychology?.psychologyPercent ?? null,
        missingExecutionConfirmations: t.executionPercent != null && t.executionPercent < 100 ? 1 : 0,
        exceededDailyRisk: dailyRiskLimit != null && (dayRisk.get(dateKey) ?? 0) > dailyRiskLimit,
        overtrade: maxPerDay != null && (dayCount.get(dateKey) ?? 0) > maxPerDay,
      },
    });

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

  // Dollar summary + drawdown for the Analytics module (from the realized $ P&L).
  const dollars = pnlStats(tradePnls);
  const drawdown = maxDrawdown(balanceSeries);

  // Phase B breakdowns (all from analyticsPoints — no extra query).
  const breakdowns = {
    dayOfWeek: dayOfWeekPerformance(analyticsPoints),
    monthly: monthlyPerformance(analyticsPoints),
    longShort: longShortPerformance(analyticsPoints),
    sessions: sessionPerformance(analyticsPoints),
    hours: hourPerformance(analyticsPoints),
    rDistribution: rMultipleDistribution(analyticsPoints),
    risk: riskStats(analyticsPoints.map((p) => p.riskPercent ?? NaN)),
  };

  // Opportunity-aware layer (additive). Resolved opportunities in range split the
  // gap into Execution Leakage (trades taken) + Missed Opportunity Cost (valid
  // setups skipped) and yield the funnel + Edge Capture %. Only meaningful once
  // opportunities are captured — `hasData` gates the UI so nothing is fabricated for
  // historical trades that never had an opportunity record.
  const [opportunityInputs, missReasons] = await Promise.all([
    getOpportunityInputs(userId, fromDate, toDate),
    getMissReasonAggregate(userId, fromDate, toDate),
  ]);
  const opportunity = {
    hasData: opportunityInputs.length > 0,
    summary: summarizeOpportunities(opportunityInputs),
    curve: buildOpportunityCurve(opportunityInputs),
    // Behavioral: which lapse (fear/hesitation/…) costs the most missed R.
    missReasons,
  };

  // Corrected Discrepancy model — the two systems (see domain/analytics/discrepancy-model):
  //  A. Performance Variance = Expected Statistical Equity (Σ strategy expectancy) − Actual.
  //     This is mostly NORMAL variance; a correctly-executed loss lands here, not in error.
  //  B. Avoidable Discrepancy = Σ objective deviation costs + validated missed-winner cost —
  //     trader-controlled leakage only. Normal Variance = A − B (the residual).
  const discrepancy = {
    curve: buildDiscrepancyCurve(correctedInputs),
    summary: summarizeDiscrepancy(correctedInputs, opportunity.summary.missedOpportunityCostR),
    // Objective avoidable causes (entry/exit/risk), for the drill-down + Psychology Lab.
    causes: aggregateDeviationCauses(deviationPrimaries),
  };

  // Counterfactual (Process-Perfect) Discrepancy Gap — the rebuilt model. Executed
  // events (from the loop) interleave with MISSED valid opportunities by chronology;
  // sequence is reassigned so the cumulative curve is truly chronological.
  const missedCfEvents = opportunityInputs
    .filter((o) => o.outcome === "MISSED")
    .map((o) => ({
      chronoKey: dateKeyToUtcDate(o.dateKey).getTime() + 12 * 60 * 60 * 1000,
      input: {
        kind: "MISSED" as const,
        eventId: o.opportunityId,
        sequence: 0,
        dateKey: o.dateKey,
        validSetup: o.valid,
        missedRealizedR: o.missedRealizedR ?? null,
      } satisfies CounterfactualInput,
    }));
  const counterfactualInputs: CounterfactualInput[] = [...cfEvents, ...missedCfEvents]
    .sort((a, b) => a.chronoKey - b.chronoKey)
    .map((e, i) => ({ ...e.input, sequence: i + 1 }));
  const counterfactual = {
    hasData: counterfactualInputs.length > 0,
    curve: buildCounterfactualCurve(counterfactualInputs),
    summary: summarizeAttribution(counterfactualInputs),
  };

  return {
    trading: {
      totalTrades: tradeInputs.length,
      closedTrades: tradeInputs.length,
      winningTrades: winningCount,
      losingTrades: losingCount,
      winRate: metrics.winRate(tradeInputs),
      winRateSeries: metrics.cumulativeWinRateSeries(tradeInputs),
      averageRR: metrics.averageRR(tradeInputs),
      profitFactor: metrics.profitFactor(tradeInputs),
      expectancy: metrics.expectancy(tradeInputs),
      averageWinner: metrics.averageWinner(tradeInputs),
      averageLoser: metrics.averageLoser(tradeInputs),
      longestWinStreak: metrics.longestWinStreak(tradeInputs),
      longestLossStreak: metrics.longestLossStreak(tradeInputs),
      breakevenTrades: dollars.breakevenTrades,
      // Realized $ performance (from the Performance Account ledger).
      netPnl: dollars.netPnl,
      grossProfit: dollars.grossProfit,
      grossLoss: dollars.grossLoss,
      largestWin: dollars.largestWin,
      largestLoss: dollars.largestLoss,
      maxDrawdownAmount: drawdown.amount,
      maxDrawdownPercent: drawdown.percent,
      recoveryFactor: recoveryFactor(dollars.netPnl, drawdown.amount),
      startingBalance: balanceBeforeRange,
      currentBalance: runningBalance,
      mostTradedAsset: metrics.mostTradedAsset(tradeInputs),
      averageTradesPerDay: metrics.averageTradesPerDay(tradeInputs, rangeDays),
      ruleAdherenceAverage,
      statsByAsset: metrics.statsByAsset(tradeInputs),
      statsByStrategy: metrics.statsByStrategy(tradeInputs),
      monthlyReturns: metrics.monthlyReturns(dailyPercents),
      equityCurve: buildEquityCurve(dailyPercents),
      discrepancy,
      counterfactual,
      opportunity,
      breakdowns,
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
