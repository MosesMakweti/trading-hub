import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { listStrategies } from "@/server/services/strategies.service";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). Thin adapter over
 * the EXISTING `strategies.service.ts::listStrategies` — no query logic
 * lives here. Returns a minimal, explicit field list (never the raw Prisma
 * row) so the strategy picker has enough to let the trader choose one, then
 * fetch its full configuration from GET /api/v1/strategies/:id.
 */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);

  const strategies = await listStrategies(auth.user.id);
  const body = {
    strategies: strategies
      .filter((s) => s.status !== "ARCHIVED")
      .map((s) => ({ id: s.id, name: s.name, version: s.version, status: s.status })),
  };
  return withCors(request, NextResponse.json(body));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
