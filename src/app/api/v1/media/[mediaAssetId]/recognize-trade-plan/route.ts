import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { recognizeStandaloneMediaAsset } from "@/server/services/trade-plan.service";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 9, Part 1 (docs/extension-api.md's
 * "Screenshot recognition" section). A thin adapter over
 * `trade-plan.service.ts::recognizeStandaloneMediaAsset` — the exact same
 * provider-resolution/invocation path (`recognizeImage`) the web app's
 * trade-scoped `runRecognition` already uses. No recognition logic lives
 * here; this route only authenticates, checks ownership (via the service's
 * own `MediaAsset.userId` check — a cross-user or unknown id resolves to
 * the SAME 404, no oracle), and serializes the result.
 *
 * Recognition FAILURE is a normal 200 response (`status:
 * "RECOGNITION_FAILED"`), not an HTTP error — matching `runRecognition`'s
 * own philosophy (spec §2: "recognition failure must not block the
 * trader"). Only a real request-level problem (401, 404) produces a
 * non-200 status. Every failure message already comes pre-sanitized from
 * the recognition provider itself (see claude-vision-provider.ts) — this
 * route adds no additional detail and never forwards provider credentials
 * or raw provider error objects.
 */
export async function POST(request: Request, { params }: { params: Promise<{ mediaAssetId: string }> }) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);

  const { mediaAssetId } = await params;

  let outcome;
  try {
    outcome = await recognizeStandaloneMediaAsset(auth.user.id, mediaAssetId);
  } catch {
    // Only thrown case is "not found or access denied" (unowned/unknown id).
    return withCors(request, NextResponse.json({ error: "Not found" }, { status: 404 }));
  }

  return withCors(request, NextResponse.json(outcome, { status: 200 }));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
