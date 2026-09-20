import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "@/server/services/api-tokens.service";

/**
 * Real integration tests against the dev Postgres DB — same pattern as
 * analytics.service.test.ts / dashboard.service.test.ts. TradingView
 * Extension — Step 2 (docs/extension-api.md).
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `api-token-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

describe("api-tokens.service.ts", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("creates a token, returns the raw value once, and NEVER persists it in plain text", async () => {
    const user = await makeUser("raw-not-stored");
    userIds.push(user.id);

    const { rawToken, token } = await createApiToken(user.id, "TradingView extension");
    expect(rawToken).toMatch(/^td_live_/);
    expect(token.tokenPrefix.startsWith("td_live_")).toBe(true);
    expect(token.tokenPrefix.length).toBeLessThan(rawToken.length);

    const row = await prisma.apiToken.findUnique({ where: { id: token.id } });
    expect(row).not.toBeNull();
    // The raw secret must not appear anywhere in the persisted row.
    expect(JSON.stringify(row)).not.toContain(rawToken);
    expect(row!.tokenHash).not.toBe(rawToken);
    expect(row!.tokenHash).toHaveLength(64); // sha256 hex
  });

  it("verifyApiToken resolves the correct user for a valid, active token", async () => {
    const user = await makeUser("verify-valid");
    userIds.push(user.id);

    const { rawToken } = await createApiToken(user.id, "test");
    const verified = await verifyApiToken(rawToken);
    expect(verified).toEqual({ userId: user.id });
  });

  it("verifyApiToken rejects garbage, wrong-prefix, and unknown tokens", async () => {
    expect(await verifyApiToken("not-a-real-token")).toBeNull();
    expect(await verifyApiToken("td_live_" + "0".repeat(43))).toBeNull(); // well-formed but never issued
  });

  it("verifyApiToken rejects a revoked token", async () => {
    const user = await makeUser("verify-revoked");
    userIds.push(user.id);

    const { rawToken, token } = await createApiToken(user.id, "test");
    expect(await verifyApiToken(rawToken)).not.toBeNull();

    await revokeApiToken(user.id, token.id);
    expect(await verifyApiToken(rawToken)).toBeNull();
  });

  it("revoking is scoped to the owning user — another user's revoke call is a no-op", async () => {
    const owner = await makeUser("revoke-owner");
    const attacker = await makeUser("revoke-attacker");
    userIds.push(owner.id, attacker.id);

    const { rawToken, token } = await createApiToken(owner.id, "test");
    await revokeApiToken(attacker.id, token.id); // wrong user — must not revoke
    expect(await verifyApiToken(rawToken)).toEqual({ userId: owner.id });
  });

  it("verifyApiToken rejects an expired token", async () => {
    const user = await makeUser("verify-expired");
    userIds.push(user.id);

    const { rawToken } = await createApiToken(user.id, "test", new Date(Date.now() - 1000));
    expect(await verifyApiToken(rawToken)).toBeNull();
  });

  it("listApiTokens never includes the hash and only returns the owning user's tokens", async () => {
    const userA = await makeUser("list-a");
    const userB = await makeUser("list-b");
    userIds.push(userA.id, userB.id);

    await createApiToken(userA.id, "A's token");
    await createApiToken(userB.id, "B's token");

    const listA = await listApiTokens(userA.id);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("A's token");
    expect(listA[0]).not.toHaveProperty("tokenHash");
  });
});
