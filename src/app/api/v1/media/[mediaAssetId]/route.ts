import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { deleteStandaloneMediaAsset } from "@/server/services/media.service";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 9, Part 9. Deletes a standalone (unattached)
 * MediaAsset the caller uploaded via `POST /api/v1/media` but never ended
 * up using — a Retake/Remove after upload, or an abandoned Trade Idea
 * (both identified as orphan sources in Step 8). A thin adapter over
 * `media.service.ts::deleteStandaloneMediaAsset` — no deletion logic lives
 * here. That function refuses to delete anything already attached to a
 * gallery (`MediaAttachment`) or a canonical `TradePlanScreenshot`, so this
 * route can never destroy media actually in use, regardless of what the
 * caller asks for.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ mediaAssetId: string }> }) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);

  const { mediaAssetId } = await params;
  const result = await deleteStandaloneMediaAsset(auth.user.id, mediaAssetId);

  if (!result.ok) {
    if (result.reason === "attached") {
      return withCors(request, NextResponse.json({ error: "This image is already attached to a trade and can't be deleted here." }, { status: 409 }));
    }
    return withCors(request, NextResponse.json({ error: "Not found" }, { status: 404 }));
  }

  return withCors(request, new NextResponse(null, { status: 204 }));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
