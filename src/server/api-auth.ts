import { NextResponse } from "next/server";

import { verifyApiToken } from "@/server/services/api-tokens.service";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). The API-route
 * equivalent of `requireUser()` (server/guards.ts) — but where that one
 * REDIRECTS an unauthenticated request (correct for a page/Server Action,
 * wrong for a JSON API), this one always resolves, either with the
 * authenticated user or with a ready-to-return `NextResponse` 401. Every
 * route under src/app/api/v1 must use this, never `requireUser()`.
 *
 * Every failure mode — missing header, malformed token, unknown token,
 * revoked token, expired token — returns the SAME generic 401 body
 * (`{ error: "Unauthorized" }`). This is deliberate: a more specific message
 * ("token revoked" vs. "token not found") would let a caller distinguish a
 * real-but-revoked token from one that never existed, which is exactly the
 * kind of oracle a credential-guessing attacker wants.
 */

export interface ApiAuthSuccess {
  ok: true;
  user: { id: string };
}
export interface ApiAuthFailure {
  ok: false;
  response: NextResponse;
}
export type ApiAuthResult = ApiAuthSuccess | ApiAuthFailure;

const UNAUTHORIZED = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function requireApiUser(request: Request): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization");
  if (!header) return { ok: false, response: UNAUTHORIZED() };

  const [scheme, rawToken] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !rawToken) {
    return { ok: false, response: UNAUTHORIZED() };
  }

  const verified = await verifyApiToken(rawToken.trim());
  if (!verified) return { ok: false, response: UNAUTHORIZED() };

  return { ok: true, user: { id: verified.userId } };
}
