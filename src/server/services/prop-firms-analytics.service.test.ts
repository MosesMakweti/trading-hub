import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createPropFirmAccount, createUserPropFirm, createPayout, updatePayout } from "@/server/services/prop-firms.service";
import { upsertExecution } from "@/server/services/trade-executions.service";
import { getExecutionAnalyticsPoints, getPaidPayoutHistory } from "@/server/services/prop-firms-analytics.service";
import { performanceByAccount, performanceByFirm } from "@/domain/prop-firms/analytics-breakdowns";
import { aggregateAccounts, type AccountRollupInput } from "@/domain/prop-firms/metrics";
import type { Prisma } from "@prisma/client";

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `pf-analytics-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeTrade(userId: string, overrides: Partial<Prisma.TradeUncheckedCreateInput> = {}) {
  return prisma.trade.create({
    data: {
      userId,
      tradeDate: new Date("2026-01-05"),
      executionMinutes: 5,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 80,
      expectedRR: 3,
      assetSymbol: "XAUUSD",
      ...overrides,
    },
  });
}

describe("getExecutionAnalyticsPoints — no double counting a multi-account idea", () => {
  let userId: string;
  let firmAId: string;
  let accountAId: string;
  let accountBId: string;

  beforeAll(async () => {
    const user = await makeUser("no-dup");
    userId = user.id;
    const firmA = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Analytics Firm A", marketCategory: "CFD" });
    firmAId = firmA.id;
    const accountA = await createPropFirmAccount(userId, {
      userPropFirmId: firmA.id,
      displayName: "Account A",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });
    const accountB = await createPropFirmAccount(userId, {
      userPropFirmId: firmA.id,
      displayName: "Account B",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 50_000,
    });
    accountAId = accountA.id;
    accountBId = accountB.id;

    const trade = await makeTrade(userId);
    await upsertExecution(userId, trade.id, {
      propFirmAccountId: accountAId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1,
      grossPnl: 1000,
      status: "CLOSED",
    });
    await upsertExecution(userId, trade.id, {
      propFirmAccountId: accountBId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 2,
      grossPnl: -300,
      status: "CLOSED",
    });
  });

  afterAll(() => cleanupUsers(userId));

  it("counts one idea allocated to 2 accounts as 2 execution points, not 1", async () => {
    const points = await getExecutionAnalyticsPoints(userId);
    expect(points).toHaveLength(2);
  });

  it("performanceByFirm sums both executions (same firm) without collapsing to one idea", async () => {
    const points = await getExecutionAnalyticsPoints(userId);
    const byFirm = performanceByFirm(points);
    expect(byFirm).toHaveLength(1);
    expect(byFirm[0].trades).toBe(2);
    expect(byFirm[0].netPnl).toBe(700); // 1000 - 300
  });

  it("performanceByAccount keeps the two accounts genuinely distinct", async () => {
    const points = await getExecutionAnalyticsPoints(userId);
    const byAccount = performanceByAccount(points);
    expect(byAccount).toHaveLength(2);
    expect(byAccount.find((a) => a.label === "Account A")?.netPnl).toBe(1000);
    expect(byAccount.find((a) => a.label === "Account B")?.netPnl).toBe(-300);
  });

  it("filters by propFirmAccountId", async () => {
    const points = await getExecutionAnalyticsPoints(userId, { propFirmAccountId: accountAId });
    expect(points).toHaveLength(1);
    expect(points[0].netPnl).toBe(1000);
  });
});

describe("payout history reconciles with metrics.ts's existing ROI formula", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("reconcile");
    userId = user.id;
    const firm = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Reconcile Firm", marketCategory: "CFD" });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Reconcile Account",
      marketCategory: "CFD",
      modelType: "INSTANT_FUNDED",
      accountSize: 50_000,
      purchasePrice: 500,
    });
    accountId = account.id;

    const payout = await createPayout(userId, accountId, { grossPayout: 2_000 });
    await updatePayout(userId, payout.id, { status: "PAID", netReceived: 1_800 });
  });

  afterAll(() => cleanupUsers(userId));

  it("getPaidPayoutHistory returns the same netReceived that metrics.ts's aggregateAccounts uses for ROI", async () => {
    const history = await getPaidPayoutHistory(userId);
    expect(history).toHaveLength(1);
    expect(history[0].netReceived?.toNumber()).toBe(1_800);

    const paidPayoutsTotal = history.reduce((sum, p) => sum + (p.netReceived?.toNumber() ?? p.grossPayout.toNumber()), 0);
    const rollupInput: AccountRollupInput = {
      status: "ACTIVE",
      startingBalance: 50_000,
      currentBalance: 50_000,
      purchasePrice: 500,
      discount: null,
      resetFees: null,
      activationFees: null,
      otherCosts: null,
      paidPayoutsTotal,
      currentStageType: "MASTER_FUNDED",
    };
    const aggregate = aggregateAccounts([rollupInput]);
    // Net Prop Firm Profit = Total Payouts Received − Total Costs = 1,800 − 500 = 1,300
    expect(aggregate.netPropFirmProfit).toBe(1_300);
    expect(aggregate.traderInvestmentRoiPercent).toBeCloseTo((1_300 / 500) * 100);
  });
});
