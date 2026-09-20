import { NextResponse } from "next/server";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). CORS for
 * src/app/api/v1/* only — every other route in the app is unaffected.
 *
 * Deliberately NOT `Access-Control-Allow-Origin: *`. These routes carry
 * authenticated, per-user data behind a bearer token; a wildcard would let
 * ANY website's JavaScript read a response if it ever got hold of a token
 * (e.g. via a trader pasting one somewhere unsafe), which defeats the point
 * of scoping the credential to begin with. Instead this reflects `Origin`
 * back ONLY when it exactly matches an entry in `EXTENSION_ALLOWED_ORIGINS`
 * (comma-separated env var) — unset/empty means NO origin is allowed, which
 * is the correct default today: no extension exists yet, so nothing should
 * be able to read these responses from browser JS across origins.
 *
 * Note this only matters for fetches made from an extension's page-context
 * script (a side panel or content script — origin `chrome-extension://
 * <extension-id>`). A Manifest V3 background/service-worker fetch with the
 * right `host_permissions` is not subject to CORS at all; this allowlist
 * only needs a real entry once/if the extension also fetches directly from
 * a page context. Once the extension has a stable published (or
 * locally-loaded, for development) ID, add its `chrome-extension://<id>`
 * origin to `EXTENSION_ALLOWED_ORIGINS` — nothing else in this file changes.
 */

function allowedOrigins(): string[] {
  return (process.env.EXTENSION_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeadersFor(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    // Idempotency-Key added in Step 3 (POST /api/v1/trades) — a custom
    // header, so it must be explicitly allowed or the browser's preflight
    // will strip it before the real request is sent.
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    // POST added in Step 3 for /api/v1/trades; GET/OPTIONS remain for the
    // read-only Step 2 endpoints. Every /api/v1 route shares this same
    // allowlist — a route that doesn't implement POST simply never receives
    // one, this header only says what's PERMITTED, not what exists.
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    // Deliberately omitted: Access-Control-Allow-Credentials. Auth here is a
    // Bearer header the caller attaches explicitly, never an ambient cookie,
    // so credentialed CORS mode is neither needed nor enabled.
  };
}

/** Wraps an existing JSON NextResponse with the right CORS headers for this request. */
export function withCors(request: Request, response: NextResponse): NextResponse {
  const headers = corsHeadersFor(request);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

/** A ready-to-return response for an `OPTIONS` preflight request. */
export function corsPreflight(request: Request): NextResponse {
  const origin = request.headers.get("origin");
  const isAllowed = !!origin && allowedOrigins().includes(origin);
  return new NextResponse(null, { status: isAllowed ? 204 : 403, headers: corsHeadersFor(request) });
}
