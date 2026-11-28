import { mt5Json, mt5Route, parseMt5, readMt5Json, requireIdempotencyKey } from "@/server/mt5-api";
import { assertIdentity, authenticateMt5Request } from "@/server/mt5-connector-auth";
import { ingestEvents } from "@/server/services/mt5-sync.service";
import { mt5EventsRequestSchema } from "@/lib/validation/mt5-connector";

export const runtime = "nodejs";

/** POST /api/v1/mt5/events — live deals/orders and observed SL/TP changes
 *  queued by the EA's OnTradeTransaction. Requires an Idempotency-Key. */
export const POST = mt5Route(async (request) => {
  const connection = await authenticateMt5Request(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readMt5Json(request);
  const body = parseMt5(mt5EventsRequestSchema, raw);
  assertIdentity(connection, body.account);
  return mt5Json(await ingestEvents(connection, body, idempotencyKey, raw));
});
