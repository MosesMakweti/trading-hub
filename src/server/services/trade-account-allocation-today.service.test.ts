import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTrade } from "@/server/services/trades.service";
import { getPerformanceConfig } from "@/server/services/performance-account.service";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import { upsertExecution } from "@/server/services/trade-executions.service";
import { listTradingAccounts } from "@/server/services/accounts.service";
import type { TradeInput } from "@/lib/validation/trades";

/**
 * Stage 6 — hiding account allocation from Today is a UI-only change
 * (trade-form.tsx / add-trade-dialog.tsx); nothing here changed server-side.
 * These tests protect the server-side guarantees the UI change depends on:
 * Today's form now always submits `allocations: []`, and that must still
 * (a) succeed and (b) still produce the automatic Performance Account
 * allocation, while a form that DOES submit real allocations (the standalone
 * Journal create/edit pages, unaffected by Stage 6) keeps working exactly as
 * before.
 */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `today-allocation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: null,
    actualRR: null,
    performanceRiskPercentOverride: null,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {},
    setupTypeId: null,
    selectedSetupConditions: [],
    setupOverrideReason: null,
    setupOverrideNote: null,
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    preTradeMoodNote: null,
    ...overrides,
  };
}

describe("Today's Add Trade Idea path — account allocation UI removed, architecture intact", () => {
  it("a trade created with no account-allocation input (Today's shape) still succeeds", async () => {
    const user = await makeUser("create-succeeds");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());
    expect(trade.id).toBeTruthy();
    expect(trade.assetSymbol).toBe("XAUUSD");
  });

  it("still creates the automatic Performance Account allocation at the account's configured default risk%", async () => {
    const user = await makeUser("auto-performance");
    const config = await getPerformanceConfig(user.id);
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());

    const allocations = await prisma.tradeAccountAllocation.findMany({
      where: { tradeId: trade.id },
      include: { tradingAccount: true },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].tradingAccount.kind).toBe("PERFORMANCE");
    expect(allocations[0].riskInputType).toBe("PERCENT");
    expect(allocations[0].riskValue.toNumber()).toBeCloseTo(config.defaultRiskPercent.toNumber(), 6);
  });

  it("a Performance risk% override still works server-side even though Today no longer exposes the control", async () => {
    const user = await makeUser("override-still-works");
    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({ performanceRiskPercentOverride: 2.5 }),
    );
    const allocation = await prisma.tradeAccountAllocation.findFirst({
      where: { tradeId: trade.id },
      include: { tradingAccount: true },
    });
    expect(allocation?.tradingAccount.kind).toBe("PERFORMANCE");
    expect(allocation?.riskValue.toNumber()).toBe(2.5);
  });

  it("resaving a trade that already has other-account allocations (as the standalone form does) preserves them", async () => {
    const user = await makeUser("preserve-on-resave");
    const firm = await createUserPropFirm(user.id, {
      identityKind: "CUSTOM",
      customCompanyName: "Stage 6 Firm",
      marketCategory: "CFD",
    });
    await createPropFirmAccount(user.id, {
      userPropFirmId: firm.id,
      displayName: "Stage 6 Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 50_000,
    });
    const [tradingAccount] = await listTradingAccounts(user.id);
    expect(tradingAccount).toBeTruthy();

    const trade = await createTrade(
      user.id,
      "2026-01-05",
      minimalTradeInput({
        allocations: [
          {
            tradingAccountId: tradingAccount.id,
            riskInputType: "PERCENT",
            riskValue: 1,
            closingPnlGross: 0,
            closingPnlNet: 0,
          },
        ],
      }),
    );

    let allocations = await prisma.tradeAccountAllocation.findMany({ where: { tradeId: trade.id } });
    expect(allocations).toHaveLength(2); // Performance + the one participating account

    // An unrelated resave with the SAME allocations resubmitted (what the
    // standalone edit form actually does — never Today, which has no edit path).
    await updateTrade(
      user.id,
      trade.id,
      minimalTradeInput({
        executionMinutes: 600,
        allocations: [
          {
            tradingAccountId: tradingAccount.id,
            riskInputType: "PERCENT",
            riskValue: 1,
            closingPnlGross: 0,
            closingPnlNet: 0,
          },
        ],
      }),
    );

    allocations = await prisma.tradeAccountAllocation.findMany({
      where: { tradeId: trade.id },
      include: { tradingAccount: true },
    });
    expect(allocations).toHaveLength(2);
    expect(allocations.some((a) => a.tradingAccountId === tradingAccount.id)).toBe(true);
  });

  it("Prop Firm account execution flows (System B) are unaffected by Today's simplified form", async () => {
    const user = await makeUser("prop-firm-unaffected");
    const trade = await createTrade(user.id, "2026-01-05", minimalTradeInput());

    const firm = await createUserPropFirm(user.id, {
      identityKind: "CUSTOM",
      customCompanyName: "Independent Firm",
      marketCategory: "CFD",
    });
    const account = await createPropFirmAccount(user.id, {
      userPropFirmId: firm.id,
      displayName: "Independent Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });

    const execution = await upsertExecution(user.id, trade.id, {
      propFirmAccountId: account.id,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1,
      grossPnl: 500,
      status: "CLOSED",
    });
    expect(execution.tradeId).toBe(trade.id);
    expect(execution.netPnl?.toNumber()).toBe(500);
  });
});
