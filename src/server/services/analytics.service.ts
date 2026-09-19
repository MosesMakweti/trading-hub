import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { daysBetweenInclusive } from "@/lib/date-ranges";
import { buildEquityCurve, dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import { isPerformanceSettled } from "@/domain/performance/realized-r";
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
  buildCounterfactualCurve,
  summarizeAttribution,
  type CounterfactualInput,
} from "@/domain/analytics/counterfactual-engine";
import { computeExpectancy } from "@/domain/performance/expectancy";
import { aggregateDeviationCauses, computeDeviations } from "@/domain/analytics/deviation-engine";
import {
  buildOpportunityCurve,
  summarizeOpportunities,
} from "@/domain/analytics/opportunity-engine";
import {
  getMissReasonAggregate,
  getOpportunityInputs,
} from "@/server/services/opportunity.service";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";
import { toStrategyPerformanceSummary } from "@/domain/analytics/canonical-aggregations";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import * as psychAnalytics from "@/domain/psychology/analytics";
import type { PsychologyDataPoint } from "@/domain/psychology/analytics";
import {
  getOrCreatePerformanceAccount,
  PERFORMANCE_ACCOUNT_STARTING_BALANCE,
} from "@/server/services/accounts.service";

/**
 * Every $ number returned here is derived from the Performance Account's real
 * dollar track record — this remains the app's single source of truth for
 * ACCOUNT/EQUITY accounting (realized $ balance, drawdown, opportunity and
 * discrepancy inputs). Stage 10.5: trader-PERFORMANCE numbers (win rate,
 * expectancy, R, strategy/asset/day breakdowns) have moved to the canonical
 * dataset (analytics-canonical.service.ts) — see `getDailyAnalytics` and
 * `getStrategyPerformance` below, which delegate to it instead of deriving R
 * from `performancePnl / balanceBeforeThatTrade * 100`.
 */
/**
 * Performance for a single strategy (win-rate / RR / psychology / adherence by
 * strategy) — Stage 10.5: delegates to the canonical, R-primary dataset
 * (`toStrategyPerformanceSummary`) instead of walking the Performance
 * Account's contribution-% ledger. All-time (no date bound), scoped to this
 * strategy's frozen `strategyId`.
 */
export async function getStrategyPerformance(userId: string, strategyId: string): Promise<StrategyPerformanceSummary> {
  const rows = await getCanonicalAnalyticsDataset(userId, { strategyId });
  return toStrategyPerformanceSummary(rows);
}

/**
 * Day-scoped analytics for the Today workspace's Daily Analytics section and
 * the Journal day recap — Stage 10.5: the SAME canonical dataset and
 * converter as `getStrategyPerformance` and every other trader-performance
 * view, scoped to this one day. `netPnl` sums the day's real settled/partial
 * $ PnL (canonical `pnl`) — one definition of "today's PnL", not a second
 * dollar computation.
 */
export async function getDailyAnalytics(userId: string, dateKey: string) {
  const rows = await getCanonicalAnalyticsDataset(userId, { from: dateKey, to: dateKey });
  const netPnl = rows.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  return { ...toStrategyPerformanceSummary(rows), netPnl };
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
      // closingPnlNet is nullable (not settled yet) — a pending trade
      // contributes 0 to this carried-forward BALANCE (aggregate
      // arithmetic), which is a different question from whether it's
      // eligible for outcome-based analytics (Stage C.1: it isn't — see
      // the main loop below, which excludes it from win/loss/discrepancy
      // classification entirely rather than treating it as a $0 trade).
      balanceBeforeRange += alloc.closingPnlNet?.toNumber() ?? 0;
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
  // Filtered equity — advances only for included trades (drawdown of the subset).
  let filteredBalance = balanceBeforeRange;
  const tradeInputs: metrics.TradeMetricInput[] = [];
  const psychologyPoints: PsychologyDataPoint[] = [];
  const adherencePoints: AdherenceTradePoint[] = [];
  const dailyPnlMap = new Map<string, number>();
  // Per-day sums of each trade's real R fields (Trade.expectedRR/actualRR — the
  // trader's planned-vs-journaled R, distinct from the %-of-balance figures fed
  // into metrics.* above) — powers the Equity Curve's Expected vs Actual mode.
  const dailyExpectedR = new Map<string, number>();
  const dailyActualR = new Map<string, number>();
  // $ P&L per trade + the running-balance series, for the dollar summary and
  // drawdown (Analytics module). Same allocations as everything else — no new query.
  const tradePnls: number[] = [];
  const balanceSeries: number[] = [balanceBeforeRange];
  // Analytics V2 §5 — parallel to balanceSeries (index-aligned, one entry
  // per settled trade plus the starting point) so the drawdown series can be
  // plotted against real dates without a second pass over the trades.
  const balanceSeriesDates: string[] = [from];
  // Per-trade points for the Phase B breakdowns (day-of-week / month / direction /
  // session / hour / risk) — built from the same rows, not a second data source.
  const analyticsPoints: AnalyticsTradePoint[] = [];
  // Analytics V2 §9 — Execution Quality: the SAME deviations computed below
  // for the counterfactual engine, also collected on their own so entry/
  // exit/risk deviation can be reported as plain differences (never a
  // second, competing calculation of what already-costed deviations mean).
  const deviationPrimaries: (ReturnType<typeof computeDeviations>["primary"])[] = [];
  let plannedTradeCount = 0; // trades with a confirmed plan to compare against
  let planFollowedCount = 0; // ...of those, trades with zero material deviations

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
    // Stage C.1: pnl is null until the Performance Account genuinely settles
    // this trade (isPerformanceSettled — domain/performance/realized-r.ts)
    // — never coalesced to 0, which is exactly what let a pending trade
    // masquerade as a real $0/0R closed trade throughout this loop.
    const settled = isPerformanceSettled(alloc.closingPnlNet);
    const pnl = alloc.closingPnlNet?.toNumber() ?? null;
    const contributionPercent = settled ? (runningBalance !== 0 ? (pnl! / runningBalance) * 100 : 0) : null;
    runningBalance += pnl ?? 0; // aggregate balance: a pending trade contributes 0 SO FAR, never a fabricated result

    // Aggregate only trades matching the active filters. The balance already
    // advanced above, so a filtered-out trade still counts toward later trades'
    // account-relative contribution %, but never enters the analytics. A
    // pending trade never matches a win/loss filter (neither is true yet).
    const included =
      (!filters?.strategyId || t.strategyId === filters.strategyId) &&
      (!filters?.entryModel || t.selectedEntryModel === filters.entryModel) &&
      (!filters?.asset || t.assetSymbol === filters.asset) &&
      (!filters?.direction || t.direction === filters.direction) &&
      (!filters?.session || (t.selectedSession ?? "") === filters.session) &&
      (!filters?.status || t.status === filters.status) &&
      (!filters?.accountId || t.allocations.some((a) => a.tradingAccountId === filters.accountId)) &&
      (!filters?.winLoss || (settled && (filters.winLoss === "win" ? pnl! > 0 : pnl! < 0)));
    if (!included) continue;

    // Outcome-based collections (equity/drawdown $, weekday/month/session/
    // hour breakdowns, R distribution) are eligible for settled trades only
    // — a pending trade contributes nothing to them yet rather than an
    // artificial $0/0R data point (never a flat equity-curve point either).
    if (settled) {
      filteredBalance += pnl!;
      tradePnls.push(pnl!);
      balanceSeries.push(filteredBalance);
      balanceSeriesDates.push(dateKey);
      analyticsPoints.push({
        dateKey,
        monthKey: dateKey.slice(0, 7),
        weekday: t.tradeDate.getUTCDay(),
        hour: Math.floor(t.executionMinutes / 60),
        pnl: pnl!,
        actualR: contributionPercent!,
        direction: t.direction,
        session: t.selectedSession ?? null,
        riskPercent: alloc.riskInputType === "PERCENT" ? alloc.riskValue.toNumber() : null,
      });
    }

    const strategyLabel = t.strategyNameSnapshot
      ? t.strategyVersionSnapshot != null
        ? `${t.strategyNameSnapshot} · v${t.strategyVersionSnapshot}`
        : t.strategyNameSnapshot
      : null;
    // Pushed for every included trade, settled or pending, so `totalTrades`
    // reflects the real recorded count (Stage C.1: trade count and settled
    // sample size are not the same thing). actualRR is null for a pending
    // trade — metrics.ts's own closedTrades() filter is already null-aware,
    // so winRate/profitFactor/averageRR/streaks exclude it automatically.
    tradeInputs.push({
      dateKey,
      assetSymbol: t.assetSymbol,
      actualRR: contributionPercent,
      strategyLabel,
    });
    dailyPnlMap.set(dateKey, (dailyPnlMap.get(dateKey) ?? 0) + (pnl ?? 0));
    if (t.expectedRR != null) {
      dailyExpectedR.set(dateKey, (dailyExpectedR.get(dateKey) ?? 0) + t.expectedRR.toNumber());
    }
    if (t.actualRR != null) {
      dailyActualR.set(dateKey, (dailyActualR.get(dateKey) ?? 0) + t.actualRR.toNumber());
    }

    // The behavioural/adherence record itself stays for every trade — a
    // pending trade can still be scored on process (confluences, execution
    // confirmations, setup quality are all known at trade time, independent
    // of settlement). Only the win/loss OUTCOME correlation is gated on
    // settlement, explicitly (not by coincidentally falling out of a 0).
    adherencePoints.push({
      win: settled ? (pnl! > 0 ? true : pnl! < 0 ? false : null) : null,
      dateKey,
      confluences: (t.selectedConfluences as string[] | null) ?? [],
      confluencePercent: t.confluencePercent,
      executionPercent: t.executionPercent,
      tradeQualityPercent: t.tradeQualityPercent,
      setupScore: t.setupScore,
      setupRating: t.setupRating as (typeof adherencePoints)[number]["setupRating"],
      direction: t.direction,
    });

    // Deviation engine: the OBJECTIVE trader-controlled R-costs (entry/exit/risk
    // slip). This — NOT expected−actual — is the avoidable discrepancy.
    const tradeActualR = t.actualRR ? t.actualRR.toNumber() : null;
    const plannedEntryNum = t.plannedEntry ? t.plannedEntry.toNumber() : null;
    const { deviations, primary } = computeDeviations({
      direction: t.direction,
      plannedEntry: plannedEntryNum,
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

    // Analytics V2 §9 — only a trade with a confirmed plan can meaningfully
    // "follow" or "deviate from" one; a freeform trade with no plan is
    // excluded from the denominator entirely rather than counting as a
    // trivial, misleading 100% follow.
    if (plannedEntryNum != null) {
      plannedTradeCount += 1;
      deviationPrimaries.push(primary);
      if (deviations.length === 0) planFollowedCount += 1;
    }

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
      // The psychology record itself is kept for a pending trade too
      // (behavioural data can exist independent of settlement); actualRR is
      // null for it, and psychAnalytics' correlation functions
      // (domain/psychology/analytics.ts) already filter `actualRR !== null`
      // before correlating psychology with profit/loss — so a pending
      // trade is counted in psychology averages but excluded from any
      // psychology-vs-outcome correlation, same split as adherencePoints.
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

  // Expected vs Actual R curve (Dashboard equity curve comparison mode) — every
  // day that had a trade, cumulative planned R vs cumulative journaled actual R.
  const expectedVsActualDays = [...new Set([...dailyExpectedR.keys(), ...dailyActualR.keys()])].sort(
    (a, b) => a.localeCompare(b),
  );
  let cumExpectedR = 0;
  let cumActualR = 0;
  const expectedVsActualCurve = expectedVsActualDays.map((dateKey) => {
    cumExpectedR += dailyExpectedR.get(dateKey) ?? 0;
    cumActualR += dailyActualR.get(dateKey) ?? 0;
    return { dateKey, cumulativeExpectedR: cumExpectedR, cumulativeActualR: cumActualR };
  });

  const ruleAdherenceValues = inRange
    .map((a) => ruleAdherenceForTrade(a.trade))
    .filter((v): v is number => v !== null);
  const ruleAdherenceAverage =
    ruleAdherenceValues.length > 0
      ? ruleAdherenceValues.reduce((s, v) => s + v, 0) / ruleAdherenceValues.length
      : null;

  const rangeDays = daysBetweenInclusive(from, to);
  // Stage C.1: a pending trade's actualRR is null, not 0 — filtering on
  // `!= null` first (rather than `?? 0`) keeps it out of both counts
  // instead of accidentally landing in neither only because 0 fails both
  // comparisons.
  const settledTradeInputs = tradeInputs.filter((t) => t.actualRR != null);
  const winningCount = settledTradeInputs.filter((t) => t.actualRR! > 0).length;
  const losingCount = settledTradeInputs.filter((t) => t.actualRR! < 0).length;

  // Dollar summary + drawdown for the Analytics module (from the realized $ P&L).
  const dollars = pnlStats(tradePnls);
  const drawdown = maxDrawdown(balanceSeries);

  // Analytics V2 §9 — Execution Quality: describes plan-vs-actual DIFFERENCES
  // (entry/exit/risk deviation, plan-follow rate), never a judgment of
  // "mistake" — that classification stays in the Discrepancy/Counterfactual
  // section above. Reuses the exact deviations already computed per trade.
  const executionQuality = {
    byCause: aggregateDeviationCauses(deviationPrimaries),
    planFollowRatePercent: plannedTradeCount > 0 ? (planFollowedCount / plannedTradeCount) * 100 : null,
    sampleSize: plannedTradeCount,
  };

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
      // Stage C.1: these are no longer the same number — totalTrades is
      // every recorded trade in range (settled or pending); closedTrades is
      // the Performance-settled sample size backing winRate/profitFactor/
      // averageRR/expectancy below (e.g. "5 trades, 4 settled").
      totalTrades: tradeInputs.length,
      closedTrades: settledTradeInputs.length,
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
      // Analytics V2 §5 — decline from the all-time peak as of right now,
      // distinct from the historical worst (maxDrawdown*). Zero at a new peak.
      currentDrawdownAmount: drawdown.currentAmount,
      currentDrawdownPercent: drawdown.currentPercent,
      // The full drawdown-through-time series, zipped with real dates —
      // never just the single worst number.
      drawdownCurve: drawdown.series.map((p) => ({
        dateKey: balanceSeriesDates[p.index],
        balance: p.balance,
        peak: p.peak,
        drawdownAmount: p.amount,
        drawdownPercent: p.percent,
      })),
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
      expectedVsActualCurve,
      counterfactual,
      opportunity,
      breakdowns,
      dailyPercents,
      // SOT strategy-adherence analytics (foundation): average confluence / execution /
      // trade-quality adherence, avg confluence count on winners vs losers, and a
      // per-confluence win-rate leaderboard. Built from each trade's frozen scores.
      adherence: summarizeAdherence(adherencePoints),
      executionQuality,
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
