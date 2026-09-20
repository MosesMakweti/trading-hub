import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken } from "@/server/services/api-tokens.service";
import { getStrategyReference } from "@/server/services/strategies.service";
import { GET as listStrategiesRoute } from "./route";
import { GET as getStrategyRoute } from "./[id]/route";

/**
 * Real integration tests against the dev Postgres DB. TradingView Extension
 * — Step 2 (docs/extension-api.md). Covers user isolation and proves the
 * API reuses the existing strategy service rather than a second
 * implementation.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `strategies-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

async function makeStrategy(userId: string, name: string) {
  const strategy = await prisma.strategy.create({ data: { userId, name, sortOrder: 0 } });
  await prisma.strategyChecklistItem.create({
    data: {
      userId,
      strategyId: strategy.id,
      kind: "CONFLUENCE",
      name: "Liquidity sweep",
      weight: 40,
      mandatory: true,
      directionApplicability: "BULLISH",
    },
  });
  return strategy;
}

function req(url: string, rawToken?: string) {
  return new Request(url, { headers: rawToken ? { authorization: `Bearer ${rawToken}` } : {} });
}

describe("GET /api/v1/strategies and /api/v1/strategies/[id]", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("401s without a valid token (list endpoint)", async () => {
    const res = await listStrategiesRoute(req("http://localhost/api/v1/strategies"));
    expect(res.status).toBe(401);
  });

  it("lists only the authenticated user's strategies", async () => {
    const userA = await makeUser("list-a");
    const userB = await makeUser("list-b");
    userIds.push(userA.id, userB.id);

    await makeStrategy(userA.id, "A's Strategy");
    await makeStrategy(userB.id, "B's Strategy");
    const { rawToken } = await createApiToken(userA.id, "test");

    const res = await listStrategiesRoute(req("http://localhost/api/v1/strategies", rawToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies).toHaveLength(1);
    expect(body.strategies[0].name).toBe("A's Strategy");
  });

  it("user isolation: User A's token cannot retrieve User B's strategy configuration (404, not another user's data)", async () => {
    const userA = await makeUser("iso-a");
    const userB = await makeUser("iso-b");
    userIds.push(userA.id, userB.id);

    const strategyB = await makeStrategy(userB.id, "B's Private Strategy");
    const { rawToken: tokenA } = await createApiToken(userA.id, "test");

    const res = await getStrategyRoute(req(`http://localhost/api/v1/strategies/${strategyB.id}`, tokenA), {
      params: Promise.resolve({ id: strategyB.id }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("B's Private Strategy");
  });

  it("existing-service reuse: the API's strategy shape is byte-for-byte what getStrategyReference() already returns", async () => {
    const user = await makeUser("reuse-proof");
    userIds.push(user.id);

    const strategy = await makeStrategy(user.id, "Reuse Proof Strategy");
    const { rawToken } = await createApiToken(user.id, "test");

    const [directResult, res] = await Promise.all([
      getStrategyReference(user.id, strategy.id),
      getStrategyRoute(req(`http://localhost/api/v1/strategies/${strategy.id}`, rawToken), {
        params: Promise.resolve({ id: strategy.id }),
      }),
    ]);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Not "similar" — the exact same object the existing service produces,
    // proving the route is a pure adapter and not a second implementation
    // of the confluence/polarity/weight/mandatory logic.
    expect(body.strategy).toEqual(directResult);
    expect(body.strategy.confluences[0]).toMatchObject({
      name: "Liquidity sweep",
      weight: 40,
      mandatory: true,
      directionApplicability: "BULLISH",
    });
  });

  it("404s for a strategy id that doesn't exist", async () => {
    const user = await makeUser("not-found");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await getStrategyRoute(req("http://localhost/api/v1/strategies/does-not-exist", rawToken), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });
});
