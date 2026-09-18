import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTrade, updateTradeSections } from "@/server/services/trades.service";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import { getAccountLedger } from "@/server/services/account-ledger.service";
import { upsertExecution } from "@/server/services/trade-executions.service";
import {
  createOrGetDailyAssetAnalysis,
  updateDailyAssetAnalysis,
} from "@/server/services/daily-asset-analysis.service";
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

describe("dailyBiasSnapshot — frozen at trade creation (Stage 4/11)", () => {
  // Cleanup batched into afterAll (same pattern as the describe block above) —
  // a Trade's allocation → Performance Account FK makes per-test cleanup via
  // user.deleteMany order-sensitive; batching at the end avoids that entirely
  // for this file's own users without affecting the assertions themselves.
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  it("freezes the asset's DailyAssetAnalysis.finalBias at first entry, unaffected by a later change to that analysis", async () => {
    const user = await makeUser("bias-freeze");
    userIds.push(user.id);

    const dateKey = "2026-07-02";
    const analysis = await createOrGetDailyAssetAnalysis(user.id, dateKey, "XAUUSD");
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "LONG" });

    const trade = await createTrade(user.id, dateKey, minimalTradeInput({ assetSymbol: "XAUUSD" }));
    expect(trade.dailyBiasSnapshot).toBe("LONG");

    // The analysis changes its mind after the trade was created — the
    // trade's frozen snapshot must not move with it.
    await updateDailyAssetAnalysis(user.id, analysis.id, { finalBias: "SHORT" });
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.dailyBiasSnapshot).toBe("LONG");
  });

  it("is null when the asset has no analysis for that day", async () => {
    const user = await makeUser("bias-freeze-none");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-07-03", minimalTradeInput({ assetSymbol: "GBPUSD" }));
    expect(trade.dailyBiasSnapshot).toBeNull();
  });
});

// Today V2 (T3) §14 — Trade B must never inherit Trade A's mutable state.
// Only DAY context (bias, active strategy, session) is an intentional
// default, and that inheritance happens client-side in the trade FORM
// (add-trade-dialog.tsx / trade-form.tsx defaultValues), never server-side —
// createTrade is (and must remain) a pure function of its own TradeInput,
// with no read of any other trade for the same user/day.
describe("createTrade — trade isolation (Today V2 T3 §14)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupUsers(...userIds);
  });

  it("a second trade for the same day starts with none of the first trade's mutable fields", async () => {
    const user = await makeUser("isolation");
    userIds.push(user.id);

    const tradeA = await createTrade(
      user.id,
      "2026-07-10",
      minimalTradeInput({
        assetSymbol: "XAUUSD",
        direction: "LONG",
        selectedConfluences: ["Liquidity Sweep", "FVG"],
        selectedExecution: ["Confirmed Break"],
      }),
    );
    await updateTradeSections(user.id, tradeA.id, {
      actualEntry: 100,
      actualStopLoss: 90,
      actualExit: 120,
      whatWentWell: "Trade A only",
      reasonForTrade: "Trade A's private thesis",
    });

    // A completely default, unrelated create — nothing above should leak in.
    const tradeB = await createTrade(user.id, "2026-07-10", minimalTradeInput({ assetSymbol: "EURUSD", direction: "SHORT" }));

    expect(tradeB.id).not.toBe(tradeA.id);
    expect((tradeB.selectedConfluences as string[] | null) ?? []).toEqual([]);
    expect((tradeB.selectedExecution as string[] | null) ?? []).toEqual([]);
    expect(tradeB.reasonForTrade).toBeNull();
    expect(tradeB.actualEntry).toBeNull();
    expect(tradeB.actualStopLoss).toBeNull();
    expect(tradeB.actualExit).toBeNull();
    expect(tradeB.whatWentWell).toBeNull();
    expect(tradeB.direction).toBe("SHORT"); // its OWN input, not A's LONG

    const allocationsA = await prisma.tradeAccountAllocation.findMany({ where: { tradeId: tradeA.id } });
    const allocationsB = await prisma.tradeAccountAllocation.findMany({ where: { tradeId: tradeB.id } });
    expect(allocationsA.map((a) => a.id).sort()).not.toEqual(allocationsB.map((a) => a.id).sort());
  });
});
