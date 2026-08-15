import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  advanceAccountStage,
  createPayout,
  createPropFirmAccount,
  createUserPropFirm,
  getCurrentStage,
  listUserPropFirms,
  updatePayout,
  updateUserPropFirm,
} from "@/server/services/prop-firms.service";
import { getAccountLedger } from "@/server/services/account-ledger.service";
import { ensureLegacyPropFirmsMigrated } from "@/server/services/prop-firms-migration.service";
import { MIGRATED_ACCOUNTS_FIRM_NAME } from "@/data/prop-firm-directory";

/**
 * Real integration tests against the dev Postgres DB (this file is the first
 * of that kind in the suite — everything else under src/ is a pure domain
 * unit test). "Ownership isolation" and "stage history" are inherently about
 * what the actual Prisma queries return, not something a pure function can
 * stand in for, so this is a deliberate, minimal expansion of what `npm test`
 * covers. Each `describe` block gets its own throwaway user(s), cleaned up in
 * its own `afterAll` (cascades: User -> UserPropFirm/PropFirmAccount/
 * TradingAccount all `onDelete: Cascade`), so blocks never interfere.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `pf-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function cleanupUsers(...ids: string[]) {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describe("ownership isolation", () => {
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const [user, other] = await Promise.all([makeUser("owner-a"), makeUser("owner-b")]);
    userId = user.id;
    otherUserId = other.id;
    await createUserPropFirm(userId, { identityKind: "CUSTOM", customCompanyName: "Mine", marketCategory: "CFD" });
    await createUserPropFirm(otherUserId, { identityKind: "CUSTOM", customCompanyName: "Theirs", marketCategory: "CFD" });
  });

  afterAll(() => cleanupUsers(userId, otherUserId));

  it("never returns another user's firms", async () => {
    const mine = await listUserPropFirms(userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].customCompanyName).toBe("Mine");

    const theirs = await listUserPropFirms(otherUserId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].customCompanyName).toBe("Theirs");
  });

  it("refuses to update a firm owned by someone else", async () => {
    const [mine] = await listUserPropFirms(userId);
    await expect(updateUserPropFirm(otherUserId, mine.id, { notes: "hijacked" })).rejects.toThrow();
  });
});

describe("stage ordering and advancement", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("stages");
    userId = user.id;
    const firm = await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Stage Test Firm",
      marketCategory: "CFD",
    });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "100k Test Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("creates one ACTIVE Phase 1 stage on account creation", async () => {
    const current = await getCurrentStage(userId, accountId);
    expect(current?.type).toBe("PHASE_1");
    expect(current?.status).toBe("ACTIVE");
    expect(current?.order).toBe(1);
  });

  it("closes the current stage and activates the next one without mutating history", async () => {
    const phase1Before = await getCurrentStage(userId, accountId);

    const { closed, next } = await advanceAccountStage(userId, accountId, {
      closeStatus: "PASSED",
      finalBalance: 106_000,
      nextStage: { name: "Phase 2", type: "PHASE_2", startingBalance: 100_000 },
    });

    expect(closed.id).toBe(phase1Before!.id);
    expect(closed.status).toBe("PASSED");
    expect(closed.currentBalance?.toNumber()).toBe(106_000);
    expect(closed.profitLoss?.toNumber()).toBe(6_000);
    // The stage's own starting balance/type — its permanent record — never changes.
    expect(closed.startingBalance.toNumber()).toBe(100_000);
    expect(closed.type).toBe("PHASE_1");

    expect(next?.status).toBe("ACTIVE");
    expect(next?.order).toBe(2);
    expect(next?.type).toBe("PHASE_2");

    const current = await getCurrentStage(userId, accountId);
    expect(current?.id).toBe(next?.id);

    // Re-fetch the closed stage straight from the DB to prove it's really
    // persisted as closed, not just the in-memory return value.
    const persisted = await prisma.accountStage.findUniqueOrThrow({ where: { id: closed.id } });
    expect(persisted.status).toBe("PASSED");
    expect(persisted.completionDate).not.toBeNull();
  });

  it("logs a milestone for the stage transition", async () => {
    const milestones = await prisma.accountMilestone.findMany({ where: { accountId } });
    const types = milestones.map((m) => m.type);
    expect(types).toContain("ACCOUNT_PURCHASED");
    expect(types).toContain("PHASE_PASSED");
  });

  it("refuses to advance a stage for an account you don't own", async () => {
    const intruder = await makeUser("stage-intruder");
    await expect(
      advanceAccountStage(intruder.id, accountId, { closeStatus: "FAILED" }),
    ).rejects.toThrow();
    await cleanupUsers(intruder.id);
  });
});

describe("breaching or failing a stage", () => {
  let userId: string;

  afterAll(() => cleanupUsers(userId));

  it("does not auto-activate a pending next stage, and closes the account out at the same status", async () => {
    const user = await makeUser("breach");
    userId = user.id;
    const firm = await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Breach Test Firm",
      marketCategory: "CFD",
    });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Breach Test Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
      stages: [
        { name: "Phase 1", type: "PHASE_1" },
        { name: "Phase 2", type: "PHASE_2" },
      ],
    });

    const { next } = await advanceAccountStage(userId, account.id, {
      closeStatus: "BREACHED",
      finalBalance: 92_000,
    });

    expect(next).toBeNull();

    // The pre-planned Phase 2 stage stays PENDING — a breach never
    // auto-advances into it.
    const phase2 = await prisma.accountStage.findFirst({ where: { accountId: account.id, type: "PHASE_2" } });
    expect(phase2?.status).toBe("PENDING");

    const persistedAccount = await prisma.propFirmAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(persistedAccount.status).toBe("BREACHED");
  });
});

describe("advanceAccountStage ledger entries", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("ledger-stage");
    userId = user.id;
    const firm = await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Ledger Stage Test Firm",
      marketCategory: "CFD",
    });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Ledger Stage Test Account",
      marketCategory: "CFD",
      modelType: "TWO_PHASE",
      accountSize: 100_000,
    });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("posts an ACCOUNT_INITIALIZED entry on account creation", async () => {
    const entries = await getAccountLedger(userId, accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe("ACCOUNT_INITIALIZED");
    expect(entries[0].amount.toNumber()).toBe(100_000);
    expect(entries[0].balanceAfter.toNumber()).toBe(100_000);
  });

  it("computes profitLoss with exact decimal math (not float drift) and posts a STAGE_PASSED marker plus a starting-balance-reset entry for the next stage", async () => {
    // 100,000 -> 106,000.10 exercises a fractional cent that plain float
    // subtraction can mangle; Decimal must return it exactly.
    const { closed, next } = await advanceAccountStage(userId, accountId, {
      closeStatus: "PASSED",
      finalBalance: 106_000.1,
      nextStage: { name: "Phase 2", type: "PHASE_2", startingBalance: 100_000 },
    });

    expect(closed.profitLoss?.toNumber()).toBe(6_000.1);

    const entries = await getAccountLedger(userId, accountId);
    const stagePassed = entries.find((e) => e.eventType === "STAGE_PASSED");
    expect(stagePassed).toBeDefined();
    expect(stagePassed?.amount.toNumber()).toBe(0); // informational marker — doesn't move the balance itself
    expect(stagePassed?.stageId).toBe(closed.id);

    // finalBalance (106,000.10) is informational only on the AccountStage row
    // — it never posts to the ledger itself (no TRADE_PNL entries were made
    // this test), so the ledger's own running balance is still exactly
    // 100,000. The next stage also starts at 100,000, so the delta is zero
    // and NO starting-balance-reset entry should be created at all — proof
    // the reset check compares against the actual ledger balance, not the
    // stage's cosmetic currentBalance field.
    const resetEntry = entries.find((e) => e.eventType === "STAGE_STARTING_BALANCE_RESET" && e.stageId === next?.id);
    expect(resetEntry).toBeUndefined();
  });

  it("posts a STAGE_STARTING_BALANCE_RESET delta when the next stage's starting balance differs from the ledger balance", async () => {
    // Currently on Phase 2 (from the prior test), ledger balance still 100,000.
    const { next } = await advanceAccountStage(userId, accountId, {
      closeStatus: "RESET",
      nextStage: { name: "Phase 2 (reset)", type: "PHASE_2", startingBalance: 95_000 },
    });

    const entries = await getAccountLedger(userId, accountId);
    const resetEntry = entries.find((e) => e.eventType === "STAGE_STARTING_BALANCE_RESET" && e.stageId === next?.id);
    expect(resetEntry?.amount.toNumber()).toBe(-5_000); // 95,000 - 100,000
  });
});

describe("updatePayout PAID transition", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("payout");
    userId = user.id;
    const firm = await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Payout Test Firm",
      marketCategory: "CFD",
    });
    const account = await createPropFirmAccount(userId, {
      userPropFirmId: firm.id,
      displayName: "Payout Test Account",
      marketCategory: "CFD",
      modelType: "INSTANT_FUNDED",
      accountSize: 50_000,
    });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("posts one negative PAYOUT ledger entry and a PAYOUT_RECEIVED milestone when a payout transitions to PAID", async () => {
    const payout = await createPayout(userId, accountId, { grossPayout: 4_000 });

    const { milestoneId } = await updatePayout(userId, payout.id, {
      status: "PAID",
      netReceived: 3_600,
      paidDate: new Date("2026-02-01"),
    });
    expect(milestoneId).not.toBeNull();

    const entries = await getAccountLedger(userId, accountId);
    const payoutEntries = entries.filter((e) => e.eventType === "PAYOUT");
    expect(payoutEntries).toHaveLength(1);
    expect(payoutEntries[0].amount.toNumber()).toBe(-3_600); // money leaving the account, not new PnL

    const milestones = await prisma.accountMilestone.findMany({ where: { accountId, type: "PAYOUT_RECEIVED" } });
    expect(milestones).toHaveLength(1);
  });

  it("is a no-op on a second PAID update — never double-posts or double-milestones", async () => {
    const payout = await createPayout(userId, accountId, { grossPayout: 1_000 });
    await updatePayout(userId, payout.id, { status: "PAID", netReceived: 900 });
    const second = await updatePayout(userId, payout.id, { status: "PAID", notes: "still paid" });
    expect(second.milestoneId).toBeNull();

    const entries = await getAccountLedger(userId, accountId);
    const thisPayoutEntries = entries.filter((e) => e.eventType === "PAYOUT" && e.sourceId === payout.id);
    expect(thisPayoutEntries).toHaveLength(1);
  });
});

describe("priority firms", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await makeUser("priority");
    userId = user.id;
    await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Second Priority",
      marketCategory: "CFD",
      isPriority: true,
      priorityOrder: 1,
    });
    await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Not Priority",
      marketCategory: "CFD",
      isPriority: false,
    });
    await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "First Priority",
      marketCategory: "CFD",
      isPriority: true,
      priorityOrder: 0,
    });
  });

  afterAll(() => cleanupUsers(userId));

  it("allows more than one priority firm at once, ordered by priorityOrder, ahead of non-priority firms", async () => {
    const firms = await listUserPropFirms(userId);
    expect(firms.map((f) => f.customCompanyName)).toEqual([
      "First Priority",
      "Second Priority",
      "Not Priority",
    ]);
    expect(firms.filter((f) => f.isPriority)).toHaveLength(2);
  });
});

describe("custom firms", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await makeUser("custom");
    userId = user.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("creates a custom firm with no directory link", async () => {
    const firm = await createUserPropFirm(userId, {
      identityKind: "CUSTOM",
      customCompanyName: "Local Prop Shop",
      customWebsite: "https://example.com",
      marketCategory: "FUTURES",
    });
    expect(firm.identityKind).toBe("CUSTOM");
    expect(firm.directoryEntryId).toBeNull();
    expect(firm.customCompanyName).toBe("Local Prop Shop");
  });
});

describe("legacy account migration", () => {
  let userId: string;
  let legacyTradingAccountId: string;

  beforeAll(async () => {
    const user = await makeUser("legacy");
    userId = user.id;
    const legacy = await prisma.tradingAccount.create({
      data: {
        userId,
        kind: "PROP_FIRM",
        name: "Old FTMO 100k",
        status: "ACTIVE",
        propFirmName: "FTMO",
        accountSize: 100_000,
        phase: "PHASE_2",
        purchaseCost: 540,
      },
    });
    legacyTradingAccountId = legacy.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("wraps an existing PROP_FIRM TradingAccount into a Migrated Accounts firm", async () => {
    await ensureLegacyPropFirmsMigrated(userId);

    const firms = await listUserPropFirms(userId);
    expect(firms).toHaveLength(1);
    expect(firms[0].customCompanyName).toBe(MIGRATED_ACCOUNTS_FIRM_NAME);
    expect(firms[0].accounts).toHaveLength(1);

    const migrated = firms[0].accounts[0];
    expect(migrated.tradingAccountId).toBe(legacyTradingAccountId);
    expect(migrated.displayName).toBe("Old FTMO 100k");
    expect(migrated.accountSize.toNumber()).toBe(100_000);
    expect(migrated.stages[0].type).toBe("PHASE_2");

    // The original ledger row is untouched — still there, still PROP_FIRM.
    const originalStillThere = await prisma.tradingAccount.findUnique({ where: { id: legacyTradingAccountId } });
    expect(originalStillThere).not.toBeNull();
    expect(originalStillThere?.kind).toBe("PROP_FIRM");
  });

  it("is idempotent — a second call does not duplicate the migrated account", async () => {
    await ensureLegacyPropFirmsMigrated(userId);
    await ensureLegacyPropFirmsMigrated(userId);

    const firms = await listUserPropFirms(userId);
    expect(firms).toHaveLength(1);
    expect(firms[0].accounts).toHaveLength(1);
  });
});
