import { NextResponse } from "next/server";
import type { z } from "zod";

import { Mt5ConnectorError } from "@/server/mt5-connector-auth";
import { LIVE_SCOPE, runLive } from "@/server/workspace/scope";
import { assertDatabaseSeesScope } from "@/server/workspace/scope-tripwire";
import { MT5_MAX_BODY_BYTES, mt5IdempotencyKeySchema } from "@/lib/validation/mt5-connector";

/**
 * MT5 Connector — shared plumbing for /api/v1/mt5/* (the connector EA's
 * endpoints). Mirrors /api/v1/trades: every handler runs in an explicit LIVE
 * workspace scope verified by the tripwire, validates with Zod and answers
 * with `{ error, code, issues? }`. No CORS headers are sent — the caller is
 * an MT5 terminal, never a browser page, so cross-origin browser reads stay
 * blocked by default.
 */

export function mt5Json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorBody(code: string, error: string, extra?: Record<string, unknown>) {
  return { error, code, ...extra };
}

export function mt5ErrorResponse(e: unknown): NextResponse {
  if (e instanceof Mt5ConnectorError) {
    // 401s stay generic — no detail about why a token didn't work.
    if (e.status === 401) return mt5Json(errorBody("UNAUTHORIZED", "Unauthorized"), 401);
    return mt5Json(errorBody(e.code, e.message, (e as Mt5ConnectorError & { extra?: Record<string, unknown> }).extra), e.status);
  }
  console.error("[mt5-connector] unexpected error", e instanceof Error ? e.message : e);
  return mt5Json(errorBody("INTERNAL", "Internal error. The request can be retried."), 500);
}

/** Runs a connector handler inside the LIVE scope, mapping errors. */
export function mt5Route(handler: (request: Request) => Promise<NextResponse>) {
  return (request: Request): Promise<NextResponse> =>
    runLive(async () => {
      try {
        assertDatabaseSeesScope(LIVE_SCOPE);
        return await handler(request);
      } catch (e) {
        return mt5ErrorResponse(e);
      }
    });
}

/** Reads a JSON body with a hard size cap (before and after reading). */
export async function readMt5Json(request: Request, maxBytes = MT5_MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Mt5ConnectorError("PAYLOAD_TOO_LARGE", 413, `Request body exceeds ${maxBytes} bytes. Send smaller batches.`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Mt5ConnectorError("PAYLOAD_TOO_LARGE", 413, `Request body exceeds ${maxBytes} bytes. Send smaller batches.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Mt5ConnectorError("MALFORMED_JSON", 400, "Malformed JSON body.");
  }
}

class Mt5ValidationError extends Mt5ConnectorError {
  constructor(readonly extra: Record<string, unknown>) {
    super("VALIDATION", 422, "Validation failed.");
  }
}

export function parseMt5<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Mt5ValidationError({ issues: parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
  }
  return parsed.data;
}

export function requireIdempotencyKey(request: Request): string {
  const parsed = mt5IdempotencyKeySchema.safeParse(request.headers.get("idempotency-key") ?? "");
  if (!parsed.success) throw new Mt5ConnectorError("IDEMPOTENCY_KEY_REQUIRED", 400, "A valid Idempotency-Key header is required.");
  return parsed.data;
}
