import { mt5Json, mt5Route, parseMt5, readMt5Json } from "@/server/mt5-api";
import { assertIdentity, authenticateMt5Request } from "@/server/mt5-connector-auth";
import { upsertSymbolSpecs } from "@/server/services/mt5-sync.service";
import { mt5SymbolsRequestSchema } from "@/lib/validation/mt5-connector";

export const runtime = "nodejs";

/** POST /api/v1/mt5/symbols — broker symbol specifications (informational
 *  in Stage 1; never written into UserInstrumentSpec). */
export const POST = mt5Route(async (request) => {
  const connection = await authenticateMt5Request(request);
  const body = parseMt5(mt5SymbolsRequestSchema, await readMt5Json(request));
  assertIdentity(connection, body.account);
  return mt5Json(await upsertSymbolSpecs(connection, body));
});
