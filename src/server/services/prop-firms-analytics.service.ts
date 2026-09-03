import { prisma } from "@/server/db";
import { evaluateRule, type RuleEvaluationContext } from "@/domain/prop-firms/rule-health";
import { accountTotalCosts, isFundedStageType, netPropFirmProfit, traderInvestmentRoiPercent } from "@/domain/prop-firms/metrics";
import {
  avgTimeToPassDays,
  challengePassRatePercent,
  performanceByAccount,
  performanceByFirm,
  performanceByFundedOrChallenge,
  performanceByMarketCategory,
  riskAllocationVsOutcome,
  ruleBreachFrequency,
  stageFailureReasons,
  type ExecutionAnalyticsPoint,
  type RuleBreachPoint,
  type StageOutcomePoint,
} from "@/domain/prop-firms/analytics-breakdowns";

export interface PropFirmAnalyticsFilters {
  from?: Date;
  to?: Date;
  propFirmId?: string;
  propFirmAccountId?: string;
  marketCategory?: "CFD" | "FUTURES";
}

/** Every CLOSED execution point needed for the performance-by-firm/account/
 *  market/funded breakdowns (spec §9). Aggregates over TradeAccountExecution
 *  rows, never Trade rows — see analytics-breakdowns.ts's file header for
 *  why that's the anti-double-count contract. */
export async function getExecutionAnalyticsPoints(userId: string, filters: PropFirmAnalyticsFilters = {}): Promise<ExecutionAnalyticsPoint[]> {
  const rows = await prisma.tradeAccountExecution.findMany({
    where: {
      userId,
      ...(filters.from || filters.to
        ? { closedAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
      ...(filters.propFirmAccountId ? { propFirmAccountId: filters.propFirmAccountId } : {}),
      propFirmAccount: {
        ...(filters.marketCategory ? { marketCategory: filters.marketCategory } : {}),
        ...(filters.propFirmId ? { userPropFirmId: filters.propFirmId } : {}),
      },
    },
    include: {
      propFirmAccount: { include: { userPropFirm: { include: { directoryEntry: true } } } },
      accountStage: true,
    },
  });

  return rows.map((row) => ({
    tradeId: row.tradeId,
    propFirmAccountId: row.propFirmAccountId,
    accountDisplayName: row.propFirmAccount.displayName,
    firmId: row.propFirmAccount.userPropFirmId,
    firmName: row.propFirmAccount.userPropFirm.directoryEntry?.companyName ?? row.propFirmAccount.userPropFirm.customCompanyName ?? "Unnamed firm",
    marketCategory: row.propFirmAccount.marketCategory,
    isFundedAccount: isFundedStageType(row.accountStage.type),
    netPnl: row.netPnl?.toNumber() ?? null,
    actualR: row.actualR?.toNumber() ?? null,
    plannedRiskAmount: row.plannedRiskAmount.toNumber(),
    riskPercentOfBase: row.riskEntryMode === "PERCENT" ? row.riskInputValue.toNumber() : null,
    status: row.status,
    closedAt: row.closedAt?.toISOString() ?? null,
  }));
}

/** Every stage outcome for challenge-pass-rate / stage-failure-reasons /
 *  avg-time-to-pass — sourced from AccountStage directly (not executions,
 *  since a stage's pass/fail is an account-level fact independent of which
 *  trades ran on it). */
export async function getStageOutcomePoints(userId: string): Promise<StageOutcomePoint[]> {
  const stages = await prisma.accountStage.findMany({ where: { account: { userId } } });
  return stages.map((s) => ({
    accountId: s.accountId,
    stageType: s.type,
    status: s.status,
    startDate: s.startDate?.toISOString() ?? null,
    completionDate: s.completionDate?.toISOString() ?? null,
  }));
}

/** Evaluates every enabled rule on every ACTIVE stage the user has, for
 *  rule-breach-frequency. Reuses the same evaluators the account workspace's
 *  live badges use — one evaluation engine, not a duplicate. */
export async function getRuleBreachPoints(userId: string): Promise<RuleBreachPoint[]> {
  const stages = await prisma.accountStage.findMany({
    where: { account: { userId }, status: "ACTIVE" },
    include: { rules: { where: { isEnabled: true } }, account: true },
  });

  const results: RuleBreachPoint[] = [];
  for (const stage of stages) {
    const [ledgerEntries, executions, latestLedgerEntry] = await Promise.all([
      prisma.accountLedgerEntry.findMany({ where: { stageId: stage.id } }),
      prisma.tradeAccountExecution.findMany({ where: { accountStageId: stage.id } }),
      prisma.accountLedgerEntry.findFirst({
        where: { accountId: stage.accountId },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        select: { balanceAfter: true },
      }),
    ]);
    const currentBalance = latestLedgerEntry?.balanceAfter.toString() ?? stage.account.startingBalance.toString();

    for (const rule of stage.rules) {
      const ctx: RuleEvaluationContext = {
        rule: {
          id: rule.id,
          ruleKey: rule.ruleKey,
          valueType: rule.valueType,
          numericValue: rule.numericValue?.toString() ?? null,
          measurementBasis: rule.measurementBasis,
          warningThreshold: rule.warningThreshold?.toString() ?? null,
          criticalThreshold: rule.criticalThreshold?.toString() ?? null,
          breachThreshold: rule.breachThreshold?.toString() ?? null,
        },
        account: { dailyResetTimezone: stage.account.dailyResetTimezone, dailyResetHour: stage.account.dailyResetHour ?? 0 },
        stage: { startingBalance: stage.startingBalance.toString(), startDate: stage.startDate, status: stage.status },
        ledgerEntries: ledgerEntries.map((e) => ({ amount: e.amount.toString(), balanceAfter: e.balanceAfter.toString(), eventType: e.eventType, occurredAt: e.occurredAt })),
        executions: executions.map((e) => ({
          netPnl: e.netPnl?.toString() ?? null,
          riskPercentOfBase: e.riskEntryMode === "PERCENT" ? e.riskInputValue.toNumber() : null,
          actualLotSize: e.actualLotSize?.toString() ?? null,
          actualContractQty: e.actualContractQty?.toString() ?? null,
          status: e.status,
          closedAt: e.closedAt,
          plannedAt: e.plannedAt,
        })),
        currentBalance,
        now: new Date(),
      };
      const result = evaluateRule(ctx);
      results.push({ ruleKey: rule.ruleKey, state: result.state });
    }
  }
  return results;
}

/** Paid payouts for funded-account payout history (spec §9/§10) — ordered
 *  most recent first. */
export async function getPaidPayoutHistory(userId: string) {
  return prisma.payout.findMany({
    where: { account: { userId }, status: "PAID" },
    include: { account: { select: { displayName: true, userPropFirmId: true } } },
    orderBy: { paidDate: "desc" },
  });
}

export interface PropFirmAnalyticsSummary {
  performanceByFirm: ReturnType<typeof performanceByFirm>;
  performanceByAccount: ReturnType<typeof performanceByAccount>;
  performanceByMarketCategory: ReturnType<typeof performanceByMarketCategory>;
  performanceByFundedOrChallenge: ReturnType<typeof performanceByFundedOrChallenge>;
  challengePassRatePercent: number | null;
  stageFailureReasons: ReturnType<typeof stageFailureReasons>;
  avgTimeToPassDays: number | null;
  ruleBreachFrequency: ReturnType<typeof ruleBreachFrequency>;
  riskAllocationVsOutcome: ReturnType<typeof riskAllocationVsOutcome>;
  netPropFirmProfit: number;
  traderInvestmentRoiPercent: number | null;
  paidPayoutsCount: number;
  paidPayoutsTotal: number;
}

/** Assembles every §9 Prop Firms analytic in one call — the data source for
 *  the Analytics page's "Prop Firms Performance" section. Net Prop Firm
 *  Profit / Trader Investment ROI reuse metrics.ts's existing formulas
 *  (unchanged), fed by the same Payout rows this function also returns as
 *  payout history, so the two reconcile by construction. */
export async function getPropFirmAnalyticsSummary(userId: string, filters: PropFirmAnalyticsFilters = {}): Promise<PropFirmAnalyticsSummary> {
  const [executionPoints, stageOutcomes, ruleBreaches, paidPayouts, accounts] = await Promise.all([
    getExecutionAnalyticsPoints(userId, filters),
    getStageOutcomePoints(userId),
    getRuleBreachPoints(userId),
    getPaidPayoutHistory(userId),
    prisma.propFirmAccount.findMany({ where: { userId } }),
  ]);

  const paidPayoutsTotal = paidPayouts.reduce((sum, p) => sum + (p.netReceived?.toNumber() ?? p.grossPayout.toNumber()), 0);
  const totalCosts = accounts.reduce(
    (sum, a) =>
      sum +
      accountTotalCosts({
        purchasePrice: a.purchasePrice?.toNumber() ?? null,
        discount: a.discount?.toNumber() ?? null,
        resetFees: a.resetFees?.toNumber() ?? null,
        activationFees: a.activationFees?.toNumber() ?? null,
        otherCosts: a.otherCosts?.toNumber() ?? null,
      }),
    0,
  );
  const profit = netPropFirmProfit(paidPayoutsTotal, totalCosts);

  return {
    performanceByFirm: performanceByFirm(executionPoints),
    performanceByAccount: performanceByAccount(executionPoints),
    performanceByMarketCategory: performanceByMarketCategory(executionPoints),
    performanceByFundedOrChallenge: performanceByFundedOrChallenge(executionPoints),
    challengePassRatePercent: challengePassRatePercent(stageOutcomes),
    stageFailureReasons: stageFailureReasons(stageOutcomes),
    avgTimeToPassDays: avgTimeToPassDays(stageOutcomes),
    ruleBreachFrequency: ruleBreachFrequency(ruleBreaches),
    riskAllocationVsOutcome: riskAllocationVsOutcome(executionPoints),
    netPropFirmProfit: profit,
    traderInvestmentRoiPercent: traderInvestmentRoiPercent(profit, totalCosts),
    paidPayoutsCount: paidPayouts.length,
    paidPayoutsTotal,
  };
}
