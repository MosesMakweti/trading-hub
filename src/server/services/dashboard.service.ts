import { prisma } from "@/server/db";
import { getDailyNote } from "@/server/services/journal.service";
import { listDailyPnl, listRecentTrades, listTradesForDay } from "@/server/services/trades.service";
import { getAnalyticsData, getAnalyticsFilterOptions, type AnalyticsFilters } from "@/server/services/analytics.service";
import { getCanonicalAnalyticsDataset, summarizeCanonicalAnalytics } from "@/server/services/analytics-canonical.service";
import { cumulativeWinRateSeries } from "@/domain/analytics/canonical-aggregations";
import { getAccountBalance, listTradingAccounts } from "@/server/services/accounts.service";
import { listStrategySessionWindows } from "@/server/services/strategy-sot.service";
import { getTradingDay } from "@/server/services/trading-day.service";
import { listUserPropFirms } from "@/server/services/prop-firms.service";
import { getLedgerDerivedBalances } from "@/server/services/account-ledger.service";
import { getCurrentStageRuleHealth } from "@/server/services/prop-firms-health.service";
import { toUserPropFirmDTO, toRuleHealthDTO, collectAccountIds } from "@/server/services/prop-firms.mapper";
import { computeBrokerageMetrics, computePropFirmRoi } from "@/domain/accounts/derived";
import { daysBetweenInclusive } from "@/lib/date-ranges";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { getTraderTodayKey } from "@/server/services/trader-time.service";
import type { PropFirmAccountDTO, RuleHealthDTO, UserPropFirmDTO } from "@/types/prop-firms";

export interface BestAccountSummary {
  name: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE";
  returnPercent: number;
}

/** One trade "day" earlier than `from`, spanning the same number of days —
 *  the comparison baseline for every KPI's period-over-period delta. Real
 *  data on both sides, never a fabricated benchmark. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const rangeDays = daysBetweenInclusive(from, to);
  const prevToDate = dateKeyToUtcDate(from);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - (rangeDays - 1));
  return { from: utcDateToKey(prevFromDate), to: utcDateToKey(prevToDate) };
}

export interface PropFirmHealthSummary {
  accountId: string;
  displayName: string;
  firmName: string;
  logoUrl: string | null;
  accentColor: string | null;
  marketCategory: "CFD" | "FUTURES";
  stageName: string | null;
  stageType: string | null;
  startingBalance: number;
  currentBalance: number | null;
  currentEquity: number | null;
  /** From the active stage's PROFIT_TARGET rule, if configured — a real
   *  `RuleHealthDTO` so the card can reuse `RuleHealthBadge` verbatim. */
  targetRule: RuleHealthDTO | null;
  /** The worst (highest percentConsumed) loss/drawdown-family rule on the
   *  active stage, if any are configured — the account's real breach risk. */
  drawdownRule: RuleHealthDTO | null;
  payoutsTotal: number;
  totalCosts: number;
  roiPercent: number | null;
}

const DRAWDOWN_FAMILY_KEYS = new Set([
  "MAX_DAILY_LOSS",
  "MAX_TOTAL_LOSS",
  "STATIC_DRAWDOWN",
  "INTRADAY_TRAILING_DRAWDOWN",
  "EOD_TRAILING_DRAWDOWN",
  "DRAWDOWN_BALANCE_BASED",
  "DRAWDOWN_EQUITY_BASED",
]);

/** Compact per-account health for the Dashboard's Prop-Firm cards — reuses
 *  the exact same fetch/map pipeline as the Prop Firms list page (`listUserPropFirms`
 *  + ledger-derived balances + `toUserPropFirmDTO`), then layers the real,
 *  already-built rule-health engine (`getCurrentStageRuleHealth`) on top for
 *  target progress / breach risk — no new balance or rule-evaluation logic. */
async function getPropFirmHealthSummaries(userId: string): Promise<PropFirmHealthSummary[]> {
  const firms = await listUserPropFirms(userId);
  const ledgerBalanceByAccountId = await getLedgerDerivedBalances(collectAccountIds(firms));
  const firmDtos: UserPropFirmDTO[] = firms.map((f) => toUserPropFirmDTO(f, new Map(), ledgerBalanceByAccountId));

  const activeAccounts: { firm: UserPropFirmDTO; account: PropFirmAccountDTO }[] = [];
  for (const firm of firmDtos) {
    for (const account of firm.accounts) {
      if (account.status === "ACTIVE") activeAccounts.push({ firm, account });
    }
  }

  return Promise.all(
    activeAccounts.map(async ({ firm, account }) => {
      const activeStage = account.stages.find((s) => s.status === "ACTIVE") ?? null;
      const ruleResults = await getCurrentStageRuleHealth(userId, account.id);
      const ruleById = new Map(
        (activeStage?.rules ?? []).map((r) => [r.id, r] as const),
      );

      let targetRule: RuleHealthDTO | null = null;
      let drawdownRule: RuleHealthDTO | null = null;

      for (const result of ruleResults) {
        const rule = ruleById.get(result.ruleId);
        if (!rule) continue;
        const dto = toRuleHealthDTO(result, rule.name, rule.ruleKey);
        if (rule.ruleKey === "PROFIT_TARGET") {
          targetRule = dto;
        } else if (DRAWDOWN_FAMILY_KEYS.has(rule.ruleKey)) {
          if (!drawdownRule || (dto.percentConsumed ?? 0) > (drawdownRule.percentConsumed ?? 0)) {
            drawdownRule = dto;
          }
        }
      }

      const totalCosts =
        Math.max(0, (account.purchasePrice ?? 0) - (account.discount ?? 0)) +
        (account.resetFees ?? 0) +
        (account.activationFees ?? 0) +
        (account.otherCosts ?? 0);
      const payoutsTotal = account.payouts
        .filter((p) => p.status === "PAID")
        .reduce((s, p) => s + (p.netReceived ?? p.grossPayout), 0);

      return {
        accountId: account.id,
        displayName: account.displayName,
        firmName: firm.companyName,
        logoUrl: firm.logoUrl,
        accentColor: firm.accentColor,
        marketCategory: account.marketCategory,
        stageName: activeStage?.name ?? null,
        stageType: activeStage?.type ?? null,
        startingBalance: account.startingBalance,
        currentBalance: account.currentBalance,
        currentEquity: account.currentEquity,
        targetRule,
        drawdownRule,
        payoutsTotal,
        totalCosts,
        roiPercent: computePropFirmRoi(account.purchasePrice, payoutsTotal),
      };
    }),
  );
}

export interface TodayRiskSummary {
  riskBudgetPercent: number | null;
  riskUsedTodayPercent: number;
  riskRemainingPercent: number | null;
  openExposurePercent: number;
  openTradeCount: number;
}

/** Real, direct derivations from `PerformanceRiskSnapshot` (locked-at-entry
 *  risk, see [[project-performance-account-benchmark]]) — never a second,
 *  parallel risk-tracking system. */
async function getTodayRiskSummary(userId: string, todayKey: string, riskBudgetPercent: number | null): Promise<TodayRiskSummary> {
  const [todaySnapshots, openSnapshots] = await Promise.all([
    prisma.performanceRiskSnapshot.findMany({
      where: { userId, trade: { tradeDate: dateKeyToUtcDate(todayKey) } },
      select: { riskPercent: true },
    }),
    prisma.performanceRiskSnapshot.findMany({
      where: { userId, trade: { status: "OPEN" } },
      select: { riskPercent: true },
    }),
  ]);

  const riskUsedTodayPercent = todaySnapshots.reduce((s, r) => s + r.riskPercent.toNumber(), 0);
  const openExposurePercent = openSnapshots.reduce((s, r) => s + r.riskPercent.toNumber(), 0);

  return {
    riskBudgetPercent,
    riskUsedTodayPercent,
    riskRemainingPercent: riskBudgetPercent != null ? riskBudgetPercent - riskUsedTodayPercent : null,
    openExposurePercent,
    openTradeCount: openSnapshots.length,
  };
}

export async function getDashboardData(
  userId: string,
  params: { from: string; to: string; accountId?: string },
) {
  const todayKey = await getTraderTodayKey(userId);
  const filters: AnalyticsFilters | undefined = params.accountId ? { accountId: params.accountId } : undefined;
  const prevRange = previousPeriod(params.from, params.to);

  const [
    todayNote,
    todayTrades,
    recentTrades,
    sessions,
    otherAccounts,
    tradingDay,
    filterOptions,
    analytics,
    previousAnalytics,
    propFirmHealth,
    dailyPnl,
    canonicalRows,
    previousCanonicalRows,
  ] = await Promise.all([
    getDailyNote(userId, todayKey),
    listTradesForDay(userId, todayKey),
    listRecentTrades(userId, 10),
    listStrategySessionWindows(userId),
    listTradingAccounts(userId),
    getTradingDay(userId, todayKey),
    getAnalyticsFilterOptions(userId),
    getAnalyticsData(userId, params.from, params.to, filters),
    getAnalyticsData(userId, prevRange.from, prevRange.to, filters),
    getPropFirmHealthSummaries(userId),
    listDailyPnl(userId),
    // Analytics V2 §21 — Dashboard/Analytics must never show a
    // differently-calculated value under the same metric name. Win Rate/
    // Profit Factor/Expectancy are trade-performance (R) metrics, so they're
    // sourced from the SAME canonical dataset Analytics uses, not the legacy
    // %-of-account-equity numbers `getAnalyticsData` still computes (that
    // function's own $ fields — netPnl, drawdown, balances — stay the
    // authority for dollar/accounting metrics; see its doc comment).
    getCanonicalAnalyticsDataset(userId, { from: params.from, to: params.to, accountId: params.accountId }),
    getCanonicalAnalyticsDataset(userId, { from: prevRange.from, to: prevRange.to, accountId: params.accountId }),
  ]);

  const canonical = summarizeCanonicalAnalytics(canonicalRows);
  const previousCanonical = summarizeCanonicalAnalytics(previousCanonicalRows);
  const withCanonicalR = <T extends typeof analytics>(source: T, summary: typeof canonical, rows: typeof canonicalRows): T => ({
    ...source,
    trading: {
      ...source.trading,
      winRate: summary.overview.winRate,
      profitFactor: summary.overview.profitFactor,
      expectancy: summary.overview.expectancy,
      winRateSeries: cumulativeWinRateSeries(rows),
    },
  });
  const dashboardAnalytics = withCanonicalR(analytics, canonical, canonicalRows);
  const dashboardPreviousAnalytics = withCanonicalR(previousAnalytics, previousCanonical, previousCanonicalRows);

  const todayRisk = await getTodayRiskSummary(
    userId,
    todayKey,
    tradingDay?.riskBudgetPercent ? tradingDay.riskBudgetPercent.toNumber() : null,
  );

  let bestAccount: BestAccountSummary | null = null;
  for (const account of otherAccounts) {
    let returnPercent: number | null = null;
    if (account.kind === "PROP_FIRM") {
      returnPercent = computePropFirmRoi(
        account.purchaseCost?.toNumber() ?? null,
        account.totalPayouts?.toNumber() ?? null,
      );
    } else {
      const currentBalance = await getAccountBalance(userId, account.id);
      returnPercent = computeBrokerageMetrics({
        startingBalance: account.startingBalance?.toNumber() ?? null,
        currentBalance,
        totalWithdrawals: account.totalWithdrawals?.toNumber() ?? null,
        totalDeposits: account.totalDeposits?.toNumber() ?? null,
      }).totalReturnPercent;
    }
    if (returnPercent !== null && (!bestAccount || returnPercent > bestAccount.returnPercent)) {
      bestAccount = {
        name: account.name,
        kind: account.kind as "PROP_FIRM" | "PERSONAL_BROKERAGE",
        returnPercent,
      };
    }
  }

  const bestAsset = analytics.trading.statsByAsset[0] ?? null;

  return {
    todayKey,
    todayNote,
    todayTrades,
    recentTrades,
    sessions,
    bestAccount,
    bestAsset,
    accounts: filterOptions.accounts,
    tradingDay,
    todayRisk,
    propFirmHealth,
    analytics: dashboardAnalytics,
    previousAnalytics: dashboardPreviousAnalytics,
    dailyPnl,
  };
}
