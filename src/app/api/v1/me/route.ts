import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). Connection-check
 * endpoint: proves a bearer token is valid and returns the minimum the
 * extension needs to confirm "connected as <name>" — nothing else. No
 * email, no account/profile data, no strategy/trade data.
 */
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { id: true, name: true },
  });
  // A verified token whose user row is gone (should not happen — ApiToken
  // cascades on user delete) is treated exactly like an invalid token.
  if (!user) return withCors(request, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  return withCors(request, NextResponse.json({ user: { id: user.id, name: user.name } }));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
