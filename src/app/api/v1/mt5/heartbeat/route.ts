import { mt5Json, mt5Route, parseMt5, readMt5Json } from "@/server/mt5-api";
import { assertIdentity, authenticateMt5Request } from "@/server/mt5-connector-auth";
import { recordHeartbeat } from "@/server/services/mt5-sync.service";
import { mt5HeartbeatRequestSchema } from "@/lib/validation/mt5-connector";

export const runtime = "nodejs";

/** POST /api/v1/mt5/heartbeat — liveness, account snapshot and open
 *  positions; tells the EA whether a backfill is still required. */
export const POST = mt5Route(async (request) => {
  const connection = await authenticateMt5Request(request);
  const body = parseMt5(mt5HeartbeatRequestSchema, await readMt5Json(request));
  assertIdentity(connection, body.account);
  return mt5Json(await recordHeartbeat(connection, body));
});
