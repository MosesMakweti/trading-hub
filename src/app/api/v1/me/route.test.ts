import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createApiToken, revokeApiToken } from "@/server/services/api-tokens.service";
import { GET } from "./route";

/**
 * Real integration tests against the dev Postgres DB, calling the actual
 * exported route handler (no running server needed — Next.js route handlers
 * are plain `(Request) => Response` functions). TradingView Extension —
 * Step 2 (docs/extension-api.md).
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { name: "Me Route Test", email: `me-route-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function requestWithAuth(header?: string) {
  return new Request("http://localhost/api/v1/me", {
    headers: header ? { authorization: header } : {},
  });
}

describe("GET /api/v1/me", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("401s with no Authorization header", async () => {
    const res = await GET(requestWithAuth());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("401s on a malformed Authorization header (wrong scheme)", async () => {
    const res = await GET(requestWithAuth("Basic dXNlcjpwYXNz"));
    expect(res.status).toBe(401);
  });

  it("401s on an unknown/garbage token", async () => {
    const res = await GET(requestWithAuth("Bearer td_live_not_a_real_token"));
    expect(res.status).toBe(401);
  });

  it("401s on a revoked token", async () => {
    const user = await makeUser("revoked");
    userIds.push(user.id);
    const { rawToken, token } = await createApiToken(user.id, "test");
    await revokeApiToken(user.id, token.id);

    const res = await GET(requestWithAuth(`Bearer ${rawToken}`));
    expect(res.status).toBe(401);
  });

  it("200s with the minimal user payload for a valid token", async () => {
    const user = await makeUser("valid");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const res = await GET(requestWithAuth(`Bearer ${rawToken}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: { id: user.id, name: "Me Route Test" } });
    // No unnecessary account/profile data leaked.
    expect(Object.keys(body.user).sort()).toEqual(["id", "name"]);
  });
});
