import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { getAccountBalance, getAccountTrackRecord, getOrCreatePerformanceAccount } from "@/server/services/accounts.service";

/** Regression: account balance/track-record lookups used to fetch by id alone
 *  (no owner check, and `findUnique` bypasses the soft-delete filter). */
const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

describe("account lookups are owner-scoped and ignore deleted accounts", () => {
  it("rejects another user's account and a soft-deleted account; serves the owner's", async () => {
    const owner = await createTestUser("acct-owner");
    const other = await createTestUser("acct-other");
    userIds.push(owner.id, other.id);

    const brokerage = await prisma.tradingAccount.create({
      data: { userId: owner.id, kind: "PERSONAL_BROKERAGE", name: "Broker", startingBalance: 5_000 },
    });
    const performance = await getOrCreatePerformanceAccount(owner.id);

    expect(await getAccountBalance(owner.id, brokerage.id)).toBe(5_000);
    expect((await getAccountTrackRecord(owner.id, performance.id)).currentBalance).toBeGreaterThan(0);

    await expect(getAccountBalance(other.id, brokerage.id)).rejects.toThrow("Trading account not found.");
    await expect(getAccountTrackRecord(other.id, performance.id)).rejects.toThrow("Trading account not found.");

    await prisma.tradingAccount.update({ where: { id: brokerage.id }, data: { deletedAt: new Date() } });
    await expect(getAccountBalance(owner.id, brokerage.id)).rejects.toThrow("Trading account not found.");
    await expect(getAccountTrackRecord(owner.id, brokerage.id)).rejects.toThrow("Trading account not found.");
  });
});
