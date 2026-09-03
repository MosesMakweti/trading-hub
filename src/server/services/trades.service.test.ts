import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTrade } from "@/server/services/trades.service";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import { getAccountLedger } from "@/server/services/account-ledger.service";
import { upsertExecution } from "@/server/services/trade-executions.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  trade-executions.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `trades-svc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: 2,
    actualRR: null,
    performanceClosingPnlGross: 0,
    performanceClosingPnlNet: 0,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    // This is the crux of the regression: the Edit Trade form has no field
    // for this at all, so every real submission defaults it to `[]` — never
    // populated with the trade's actual account executions.
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no",
      riskManaged: "yes",
      followedExitPlan: "yes",
      alignedWithBias: "yes",
      influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no",
      outcomeWillInfluenceNext: "no",
      monitoringObsession: 10,
    },
    ...overrides,
  } as TradeInput;
}

describe("updateTrade never wipes a trade's Prop Firms account executions (regression)", () => {
  let userId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("no-wipe");
    userId = user.id;

    const trade = await createTrade(userId, "2026-01-05", minimalTradeInput());
    tradeId = trade.id;

    const firm = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Regression Firm", marketCategory: "CFD" });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Regression Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });
    accountId = account.id;

    await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1,
      grossPnl: 2_000,
      status: "CLOSED",
    });
  });

  afterAll(() => cleanupUsers(userId));

  it("survives an unrelated Edit Trade save (the form never sends propFirmExecutions)", async () => {
    // Sanity: the execution + its ledger entry exist before the edit.
    const beforeExecutions = await prisma.tradeAccountExecution.findMany({ where: { tradeId } });
    expect(beforeExecutions).toHaveLength(1);
    let ledger = await getAccountLedger(userId, accountId);
    expect(ledger.some((e) => e.eventType === "TRADE_PNL")).toBe(true);

    // Simulate the real Edit Trade form: change an unrelated field, leave
    // propFirmExecutions at its default [].
    await updateTrade(userId, tradeId, minimalTradeInput({ executionMinutes: 600, psychPreTradeMindset: "Edited via the trade form" }));

    const afterExecutions = await prisma.tradeAccountExecution.findMany({ where: { tradeId, deletedAt: null } });
    expect(afterExecutions).toHaveLength(1);
    expect(afterExecutions[0].status).toBe("CLOSED");
    expect(afterExecutions[0].netPnl?.toNumber()).toBe(2_000);

    // The ledger's TRADE_PNL entry must not have been reversed either.
    ledger = await getAccountLedger(userId, accountId);
    expect(ledger.some((e) => e.eventType === "TRADE_PNL")).toBe(true);
    expect(ledger.find((e) => e.eventType === "TRADE_PNL")?.amount.toNumber()).toBe(2_000);
  });
});
