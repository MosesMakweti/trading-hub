import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { requireApiUser } from "@/server/api-auth";
import { createApiToken } from "@/server/services/api-tokens.service";

/**
 * TradingView Extension — Step 10, §7 (API Security Audit). Dedicated,
 * direct coverage for `requireApiUser` itself — previously only exercised
 * indirectly through each `/api/v1/*` route's own tests. Real integration
 * tests against the dev Postgres DB — same pattern as
 * api-tokens.service.test.ts.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `api-auth-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://traditorium.com/api/v1/me", { headers });
}

describe("requireApiUser", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("401s with no Authorization header at all", async () => {
    const result = await requireApiUser(req());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(401);
    expect(await result.response.clone().json()).toEqual({ error: "Unauthorized" });
  });

  it("401s on a non-bearer scheme (e.g. Basic)", async () => {
    const result = await requireApiUser(req({ authorization: "Basic dXNlcjpwYXNz" }));
    expect(result.ok).toBe(false);
  });

  it("401s on 'Bearer' with no token value", async () => {
    const result = await requireApiUser(req({ authorization: "Bearer " }));
    expect(result.ok).toBe(false);
  });

  it("401s on a well-formed-looking but never-issued token", async () => {
    const result = await requireApiUser(req({ authorization: `Bearer td_live_${"0".repeat(43)}` }));
    expect(result.ok).toBe(false);
  });

  it("resolves the correct user for a genuinely valid token", async () => {
    const user = await makeUser("valid");
    userIds.push(user.id);
    const { rawToken } = await createApiToken(user.id, "test");

    const result = await requireApiUser(req({ authorization: `Bearer ${rawToken}` }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.user.id).toBe(user.id);
  });

  /**
   * §7 — "no accidental session-auth bypass." `requireApiUser`'s entire
   * implementation only ever reads the `authorization` header (see
   * api-auth.ts) — it has no import of, or call to, anything
   * session/cookie-related. This test pins that boundary as an explicit,
   * regression-proof behavior rather than leaving it as something only
   * true by inspection: a NextAuth-shaped session cookie, present with NO
   * Authorization header, must still 401 exactly like having no
   * credential at all — a session cookie is never an alternate path into
   * `/api/v1/*`.
   */
  it("a NextAuth-shaped session cookie, with no Authorization header, is never treated as a credential", async () => {
    const result = await requireApiUser(
      req({ cookie: "authjs.session-token=some-real-looking-session-value; next-auth.session-token=another-one" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(401);
  });

  it("every failure mode returns the exact same generic body — never distinguishing WHY auth failed", async () => {
    const user = await makeUser("revoked-vs-unknown");
    userIds.push(user.id);
    const { rawToken, token } = await createApiToken(user.id, "test");
    const { revokeApiToken } = await import("@/server/services/api-tokens.service");
    await revokeApiToken(user.id, token.id);

    const noHeader = await requireApiUser(req());
    const unknown = await requireApiUser(req({ authorization: `Bearer td_live_${"1".repeat(43)}` }));
    const revoked = await requireApiUser(req({ authorization: `Bearer ${rawToken}` }));

    for (const result of [noHeader, unknown, revoked]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.response.status).toBe(401);
      expect(await result.response.clone().json()).toEqual({ error: "Unauthorized" });
    }
  });
});
