import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { getStrategyReference } from "@/server/services/strategies.service";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). Thin adapter over
 * the EXISTING `strategies.service.ts::getStrategyReference` — the exact
 * same function `loadStrategyReference` (actions/trades.actions.ts) calls
 * for the web app's Add Trade form. No confluence/entry-model/execution/
 * trade-management query logic is reimplemented here.
 *
 * `getStrategyReference` already scopes its query to `{ id, userId }`
 * (server/services/strategies.service.ts:511) — it returns null for a
 * strategy that doesn't exist OR belongs to a different user, which this
 * route maps to a 404 either way. This is what makes "never return another
 * user's strategy configuration" true by construction, not by an extra
 * check bolted on here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);

  const { id } = await params;
  const reference = await getStrategyReference(auth.user.id, id);
  if (!reference) return withCors(request, NextResponse.json({ error: "Not found" }, { status: 404 }));

  return withCors(request, NextResponse.json({ strategy: reference }));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
