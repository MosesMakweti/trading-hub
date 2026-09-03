import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { createPropFirmAccount, createUserPropFirm, advanceAccountStage } from "@/server/services/prop-firms.service";
import { getAccountLedger } from "@/server/services/account-ledger.service";
import {
  listExecutionsForTrade,
  removeExecution,
  upsertExecution,
} from "@/server/services/trade-executions.service";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  prop-firms.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `exec-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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
      plannedEntry: "2000",
      plannedStopLoss: "1990",
      plannedTarget: "2030",
      ...overrides,
    },
  });
}

async function makeAccount(userId: string, displayName: string, modelType: "TWO_PHASE" | "INSTANT_FUNDED" = "TWO_PHASE") {
  const firm = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: `${displayName} Firm`, marketCategory: "CFD" });
  return createPropFirmAccount(userId, {
    userPropFirmId: firm.id,
    displayName,
    marketCategory: "CFD",
    modelType,
    accountSize: 100_000,
  });
}

describe("one Trade Idea allocated to several accounts", () => {
  let userId: string;
  let tradeId: string;
  let accountAId: string;
  let accountBId: string;

  beforeAll(async () => {
    const user = await makeUser("multi-account");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const [a, b] = await Promise.all([makeAccount(userId, "Account A"), makeAccount(userId, "Account B")]);
    accountAId = a.id;
    accountBId = b.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("creates independent executions per account without duplicating the shared idea", async () => {
    await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountAId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1, // 1% of 100,000 = 1,000
    });
    await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountBId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 2, // 2% of 100,000 = 2,000
    });

    const executions = await listExecutionsForTrade(userId, tradeId);
    expect(executions).toHaveLength(2);

    const execA = executions.find((e) => e.propFirmAccountId === accountAId)!;
    const execB = executions.find((e) => e.propFirmAccountId === accountBId)!;
    expect(execA.plannedRiskAmount.toNumber()).toBe(1_000);
    expect(execB.plannedRiskAmount.toNumber()).toBe(2_000);

    // Still exactly one Trade row — a shared idea, not duplicated.
    const trades = await prisma.trade.count({ where: { id: tradeId } });
    expect(trades).toBe(1);
  });

  it("inherits the idea's planned entry/stop/target unless a per-execution override is set", async () => {
    const executions = await listExecutionsForTrade(userId, tradeId);
    const execA = executions.find((e) => e.propFirmAccountId === accountAId)!;
    expect(execA.plannedEntryOverride).toBeNull();
    expect(execA.plannedR?.toNumber()).toBe(3); // (2030-2000)/(2000-1990) = 3
  });

  it("editing one account's execution never leaks into the other (per-trade data isolation)", async () => {
    await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountAId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1,
      executionNotes: "Edited note for A only",
      actualEntry: 2001,
    });

    const executions = await listExecutionsForTrade(userId, tradeId);
    const execA = executions.find((e) => e.propFirmAccountId === accountAId)!;
    const execB = executions.find((e) => e.propFirmAccountId === accountBId)!;
    expect(execA.executionNotes).toBe("Edited note for A only");
    expect(execA.actualEntry?.toNumber()).toBe(2001);
    expect(execB.executionNotes).toBeNull();
    expect(execB.actualEntry).toBeNull();
  });

  it("removing one account's allocation doesn't affect the other", async () => {
    await removeExecution(userId, tradeId, accountAId);
    const executions = await listExecutionsForTrade(userId, tradeId);
    expect(executions.find((e) => e.propFirmAccountId === accountAId)).toBeUndefined();
    expect(executions.find((e) => e.propFirmAccountId === accountBId)).toBeDefined();
  });
});

describe("actual PnL, estimated PnL, and idempotent ledger posting", () => {
  let userId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("pnl");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const account = await makeAccount(userId, "PnL Test Account");
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("computes Net PnL and Actual R from gross PnL and fees when the trade closes", async () => {
    const execution = await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1_000,
      grossPnl: 2_100,
      commission: 50,
      swapFinancing: 10,
      otherFees: 5,
      status: "CLOSED",
    });
    expect(execution.netPnl?.toNumber()).toBe(2_035); // 2100 - 50 - 10 - 5
    expect(execution.actualR?.toNumber()).toBe(2.035); // 2035 / 1000
    expect(execution.isPnlEstimated).toBe(false);
  });

  it("posts an idempotent TRADE_PNL ledger entry that updates in place on re-save (never duplicates)", async () => {
    let entries = await getAccountLedger(userId, accountId);
    expect(entries.filter((e) => e.eventType === "TRADE_PNL")).toHaveLength(1);

    // Re-save with a corrected gross PnL — simulates an edit/resync.
    await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1_000,
      grossPnl: 2_200,
      commission: 50,
      swapFinancing: 10,
      otherFees: 5,
      status: "CLOSED",
    });

    entries = await getAccountLedger(userId, accountId);
    const tradePnlEntries = entries.filter((e) => e.eventType === "TRADE_PNL");
    expect(tradePnlEntries).toHaveLength(1);
    expect(tradePnlEntries[0].amount.toNumber()).toBe(2_135); // 2200 - 50 - 10 - 5
  });

  it("uses Actual R × Planned Risk Amount as an ESTIMATED Net PnL when no gross PnL is available yet", async () => {
    const trade2 = await makeTrade(userId, { assetSymbol: "EURUSD" });
    const execution = await upsertExecution(userId, trade2.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      actualR: 2,
      status: "CLOSED",
    });
    expect(execution.isPnlEstimated).toBe(true);
    expect(execution.netPnl?.toNumber()).toBe(1_000); // 2 × 500
  });

  it("real gross PnL overrides a previously estimated Net PnL", async () => {
    const trade3 = await makeTrade(userId, { assetSymbol: "GBPUSD" });
    const estimated = await upsertExecution(userId, trade3.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      actualR: 1,
      status: "CLOSED",
    });
    expect(estimated.isPnlEstimated).toBe(true);

    const confirmed = await upsertExecution(userId, trade3.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      grossPnl: 480,
      status: "CLOSED",
    });
    expect(confirmed.isPnlEstimated).toBe(false);
    expect(confirmed.netPnl?.toNumber()).toBe(480);
  });

  it("removing an execution deletes its ledger entry too", async () => {
    const trade4 = await makeTrade(userId, { assetSymbol: "USDJPY" });
    const execution = await upsertExecution(userId, trade4.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      grossPnl: 600,
      status: "CLOSED",
    });
    let entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === execution.id)).toBe(true);

    await removeExecution(userId, trade4.id, accountId);
    entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === execution.id)).toBe(false);
  });
});

describe("risk amount is frozen at first confirmation (spec §1)", () => {
  let userId: string;
  let tradeAId: string;
  let tradeBId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("freeze");
    userId = user.id;
    const [tradeA, tradeB] = await Promise.all([makeTrade(userId, { assetSymbol: "XAUUSD" }), makeTrade(userId, { assetSymbol: "US30" })]);
    tradeAId = tradeA.id;
    tradeBId = tradeB.id;
    const account = await makeAccount(userId, "Freeze Test Account");
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("does not recompute plannedRiskAmount from a since-changed balance when an unrelated field is edited", async () => {
    const created = await upsertExecution(userId, tradeAId, {
      propFirmAccountId: accountId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1, // 1% of 100,000 = 1,000
    });
    expect(created.plannedRiskAmount.toNumber()).toBe(1_000);
    expect(created.riskBaseSnapshot.toNumber()).toBe(100_000);

    // Another trade on the SAME account closes and moves the ledger balance
    // to 110,000 — a future save of tradeA's allocation must not silently
    // re-price its already-confirmed risk off this new balance.
    await upsertExecution(userId, tradeBId, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1_000,
      grossPnl: 10_000,
      status: "CLOSED",
    });

    const edited = await upsertExecution(userId, tradeAId, {
      propFirmAccountId: accountId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1, // same inputs as before — no explicit re-risk
      executionNotes: "just adding a note",
    });
    expect(edited.plannedRiskAmount.toNumber()).toBe(1_000); // unchanged, NOT 1,100 (1% of the new 110,000 balance)
    expect(edited.riskBaseSnapshot.toNumber()).toBe(100_000);
  });

  it("does recompute when the trader explicitly changes the risk input value", async () => {
    const reRisked = await upsertExecution(userId, tradeAId, {
      propFirmAccountId: accountId,
      riskEntryMode: "PERCENT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 2, // explicit change from 1% to 2%
    });
    expect(reRisked.riskBaseSnapshot.toNumber()).toBe(110_000); // now resolved against the current balance
    expect(reRisked.plannedRiskAmount.toNumber()).toBe(2_200); // 2% of 110,000
  });
});

describe("the new Account Trade Participation status vocabulary (spec §3)", () => {
  let userId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("status-vocab");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const account = await makeAccount(userId, "Status Vocab Account");
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("refuses to save a CLOSED execution with no gross PnL and no actual R", async () => {
    await expect(
      upsertExecution(userId, tradeId, {
        propFirmAccountId: accountId,
        riskEntryMode: "PERCENT",
        riskBasis: "CURRENT_BALANCE",
        riskInputValue: 1,
        status: "CLOSED",
      }),
    ).rejects.toThrow();
  });

  it("PARTIALLY_CLOSED with a gross PnL posts to the ledger just like CLOSED does", async () => {
    const execution = await upsertExecution(userId, tradeId, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 1_000,
      grossPnl: 400,
      status: "PARTIALLY_CLOSED",
    });
    expect(execution.netPnl?.toNumber()).toBe(400);
    const entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === execution.id && e.eventType === "TRADE_PNL")).toBe(true);
  });

  it("MISSED never posts a ledger entry and clears any prior one", async () => {
    const trade2 = await makeTrade(userId, { assetSymbol: "AUDUSD" });
    const closed = await upsertExecution(userId, trade2.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      grossPnl: 250,
      status: "CLOSED",
    });
    let entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === closed.id)).toBe(true);

    // Reopened as MISSED (e.g. corrected after a data-entry mistake) — the
    // account's balance must no longer reflect this participation.
    const missed = await upsertExecution(userId, trade2.id, {
      propFirmAccountId: accountId,
      riskEntryMode: "AMOUNT",
      riskBasis: "CURRENT_BALANCE",
      riskInputValue: 500,
      status: "MISSED",
    });
    expect(missed.netPnl).toBeNull();
    entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === missed.id)).toBe(false);
  });
});

describe("restrictions on archived, breached, or failed accounts", () => {
  let userId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("restricted");
    userId = user.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const account = await makeAccount(userId, "Restricted Account");
    accountId = account.id;
    await advanceAccountStage(userId, accountId, { closeStatus: "BREACHED", finalBalance: 90_000 });
  });

  afterAll(() => cleanupUsers(userId));

  it("refuses a new allocation on a breached account", async () => {
    await expect(
      upsertExecution(userId, tradeId, {
        propFirmAccountId: accountId,
        riskEntryMode: "PERCENT",
        riskBasis: "CURRENT_BALANCE",
        riskInputValue: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("ownership isolation", () => {
  let userId: string;
  let otherUserId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    const [user, other] = await Promise.all([makeUser("exec-owner-a"), makeUser("exec-owner-b")]);
    userId = user.id;
    otherUserId = other.id;
    const trade = await makeTrade(userId);
    tradeId = trade.id;
    const account = await makeAccount(userId, "Owned Account");
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId, otherUserId));

  it("refuses to allocate another user's trade against your account, or vice versa", async () => {
    await expect(
      upsertExecution(otherUserId, tradeId, {
        propFirmAccountId: accountId,
        riskEntryMode: "PERCENT",
        riskBasis: "CURRENT_BALANCE",
        riskInputValue: 1,
      }),
    ).rejects.toThrow();
  });
});
