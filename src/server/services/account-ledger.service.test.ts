import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import {
  createManualAdjustment,
  getAccountLedger,
  getLedgerDerivedBalance,
  postLedgerEntry,
  removeLedgerEntriesForSource,
} from "@/server/services/account-ledger.service";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  prop-firms.service.test.ts (throwaway users, cascading cleanup). */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `ledger-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeAccount(userId: string) {
  const firm = await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Ledger Test Firm", marketCategory: "CFD" });
  return createPropFirmAccount(userId, {
    userPropFirmId: firm.id,
    displayName: "Ledger Test Account",
    marketCategory: "CFD",
    modelType: "TWO_PHASE",
    accountSize: 100_000,
  });
}

describe("postLedgerEntry idempotency", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("idempotency");
    userId = user.id;
    const account = await makeAccount(userId);
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("upserts the same row on a repeated (sourceType, sourceId, eventType) instead of duplicating", async () => {
    await prisma.$transaction((tx) =>
      postLedgerEntry(tx, {
        accountId,
        eventType: "TRADE_PNL",
        amount: 500,
        sourceType: "TRADE_EXECUTION",
        sourceId: "execution-1",
      }),
    );
    await prisma.$transaction((tx) =>
      postLedgerEntry(tx, {
        accountId,
        eventType: "TRADE_PNL",
        amount: 750, // simulates a trade edit changing the PnL
        sourceType: "TRADE_EXECUTION",
        sourceId: "execution-1",
      }),
    );

    const entries = await getAccountLedger(userId, accountId);
    const tradePnlEntries = entries.filter((e) => e.sourceId === "execution-1");
    expect(tradePnlEntries).toHaveLength(1);
    expect(tradePnlEntries[0].amount.toNumber()).toBe(750);
  });

  it("recomputes balanceAfter correctly after the amount changes", async () => {
    const balance = await getLedgerDerivedBalance(userId, accountId);
    // 100,000 (ACCOUNT_INITIALIZED) + 750 (the updated TRADE_PNL entry) = 100,750
    expect(balance?.toNumber()).toBe(100_750);
  });

  it("manual adjustments are never deduped against each other — every one stays in history", async () => {
    await createManualAdjustment(userId, accountId, { amount: 10, reason: "Test adjustment A", eventType: "MANUAL_ADJUSTMENT" });
    await createManualAdjustment(userId, accountId, { amount: 20, reason: "Test adjustment B", eventType: "MANUAL_ADJUSTMENT" });

    const entries = await getAccountLedger(userId, accountId);
    const manualEntries = entries.filter((e) => e.eventType === "MANUAL_ADJUSTMENT");
    expect(manualEntries).toHaveLength(2);
  });

  it("requires a reason for a manual adjustment", async () => {
    await expect(
      createManualAdjustment(userId, accountId, { amount: 10, reason: "", eventType: "MANUAL_ADJUSTMENT" }),
    ).rejects.toThrow();
  });

  it("removeLedgerEntriesForSource deletes the source's entry and recomputes the running balance", async () => {
    const balanceBefore = await getLedgerDerivedBalance(userId, accountId);
    await prisma.$transaction((tx) => removeLedgerEntriesForSource(tx, accountId, "TRADE_EXECUTION", "execution-1"));
    const balanceAfter = await getLedgerDerivedBalance(userId, accountId);
    expect(balanceAfter?.toNumber()).toBe(balanceBefore!.toNumber() - 750);

    const entries = await getAccountLedger(userId, accountId);
    expect(entries.some((e) => e.sourceId === "execution-1")).toBe(false);
  });
});

describe("ownership isolation", () => {
  let userId: string;
  let otherUserId: string;
  let accountId: string;

  beforeAll(async () => {
    const [user, other] = await Promise.all([makeUser("owner-a"), makeUser("owner-b")]);
    userId = user.id;
    otherUserId = other.id;
    const account = await makeAccount(userId);
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId, otherUserId));

  it("refuses to read another user's ledger", async () => {
    await expect(getAccountLedger(otherUserId, accountId)).rejects.toThrow();
  });

  it("refuses to post a manual adjustment to another user's account", async () => {
    await expect(
      createManualAdjustment(otherUserId, accountId, { amount: 10, reason: "hijack", eventType: "MANUAL_ADJUSTMENT" }),
    ).rejects.toThrow();
  });
});
