import { mt5Json, mt5Route, parseMt5, readMt5Json } from "@/server/mt5-api";
import { clientIpFrom } from "@/server/mt5-connector-auth";
import { pairMt5Terminal } from "@/server/services/mt5-connector.service";
import { mt5PairRequestSchema } from "@/lib/validation/mt5-connector";

export const runtime = "nodejs";

/**
 * POST /api/v1/mt5/pair — exchanges a single-use pairing code (shown in
 * Settings → Integrations) for an MT5 connector device token. The only
 * unauthenticated connector endpoint: rate-limited per client IP. Never
 * accepts or stores an MT5 password. See docs/MT5_CONNECTOR.md.
 */
export const POST = mt5Route(async (request) => {
  const body = parseMt5(mt5PairRequestSchema, await readMt5Json(request, 16_000));
  const result = await pairMt5Terminal(body, clientIpFrom(request));
  return mt5Json(result, 201);
});
