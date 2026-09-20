import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { reserveIdempotencyKey, recordIdempotencyResult } from "@/server/api-idempotency";
import { apiCreateTradeSchema } from "@/lib/validation/api-trades";
import { isValidDateKey, localDateToKey } from "@/lib/date";
import { dayEditableGuard } from "@/actions/day-guard";
import { getStrategyReference } from "@/server/services/strategies.service";
import * as tradesService from "@/server/services/trades.service";
import * as tradePlanService from "@/server/services/trade-plan.service";
import { toApiTradeDTO } from "@/server/services/api-trade-dto";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 3 (docs/extension-api.md). The first external
 * write path. This route is an ADAPTER ONLY:
 *
 *   parse/validate request  →  createTrade()  →  savePlan()?  →
 *   updateTradeSections()?  →  attachPlanScreenshot()?  →  serialize
 *
 * Every one of those four calls is the EXACT, unmodified service function
 * the web app's own Server Actions already call (trades.actions.ts,
 * trade-plan.actions.ts) — no query, scoring, RR, or ownership logic is
 * reimplemented here. See docs/extension-api.md for the full contract.
 */

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function badRequest(request: Request, error: string, status: number, extra?: Record<string, unknown>) {
  return withCors(request, NextResponse.json({ error, ...extra }, { status }));
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.id;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest(request, "Malformed JSON body.", 400);
  }

  const parsed = apiCreateTradeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest(request, "Validation failed.", 422, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const input = parsed.data;
  const dateKey = input.dateKey ?? localDateToKey(new Date());
  if (!isValidDateKey(dateKey)) return badRequest(request, "Invalid dateKey.", 422);

  // Idempotency (opt-in — only engaged when the caller sends the header).
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const check = await reserveIdempotencyKey(userId, idempotencyKey, rawBody);
    if (check.status === "conflict") {
      return badRequest(request, "This Idempotency-Key was already used with a different request body.", 409);
    }
    if (check.status === "replay") {
      if (!check.tradeId) {
        // Another request with this exact key is still in flight — do not
        // create a second trade; the caller should retry shortly.
        return badRequest(request, "A request with this Idempotency-Key is already being processed.", 409);
      }
      const existing = await tradesService.getTrade(userId, check.tradeId);
      if (!existing) {
        return badRequest(request, "The trade originally created for this Idempotency-Key no longer exists.", 409);
      }
      return withCors(request, NextResponse.json({ trade: toApiTradeDTO(existing), replayed: true }, { status: 200 }));
    }
    // status === "new" — fall through and create it.
  }

  // Same guard a web-created trade goes through (trades.actions.ts::createTrade)
  // — an archived/closed trading day is read-only for every client, not just
  // the web app.
  const blocked = await dayEditableGuard(userId, dateKey);
  if (blocked) return badRequest(request, blocked.error, 422);

  // Strategy ownership — reuses the SAME ownership-scoped query
  // getStrategyReference() already performs (server/services/strategies.
  // service.ts:511: `where: { id, userId }`). trades.service.ts's own
  // buildTradeSnapshots() also re-checks this and silently drops an
  // unowned strategyId to null rather than erroring (the existing, shared
  // web-app behavior — unchanged here). This route additionally fails the
  // WHOLE request up front for a foreign strategyId, which is a stricter,
  // API-layer-only ergonomics choice (a programmatic client benefits far
  // more from an explicit 422 than from silently getting back a trade with
  // strategyId: null) — built on the exact same primitive, not a new rule.
  if (input.trade.strategyId) {
    const ref = await getStrategyReference(userId, input.trade.strategyId);
    if (!ref) return badRequest(request, "strategyId not found.", 422);
  }

  let trade;
  try {
    trade = await tradesService.createTrade(userId, dateKey, input.trade);
  } catch (e) {
    return badRequest(request, errorMessage(e, "Could not create the trade."), 422);
  }

  // The core trade now exists and is committed. Everything below is a
  // separate, optional, already-existing follow-up step — exactly the same
  // multi-step shape the web app itself uses (confirm a plan, add notes,
  // attach a screenshot all happen as their own calls after the trade
  // exists). A failure here does not roll back the trade; it's reported as
  // a warning so the caller knows exactly what didn't apply and can retry
  // that one step against the now-known trade id.
  const warnings: string[] = [];

  if (input.plan) {
    try {
      await tradePlanService.savePlan(userId, trade.id, { direction: input.trade.direction, ...input.plan });
    } catch (e) {
      warnings.push(`plan: ${errorMessage(e, "Could not save the planned targets.")}`);
    }
  }

  const notes = input.notes;
  if (notes && Object.values(notes).some((v) => v !== undefined)) {
    try {
      await tradesService.updateTradeSections(userId, trade.id, notes);
    } catch (e) {
      warnings.push(`notes: ${errorMessage(e, "Could not save trade notes.")}`);
    }
  }

  if (input.mediaAssetId) {
    try {
      await tradePlanService.attachPlanScreenshot(userId, trade.id, input.mediaAssetId);
    } catch (e) {
      warnings.push(`mediaAssetId: ${errorMessage(e, "Could not attach the screenshot.")}`);
    }
  }

  if (idempotencyKey) await recordIdempotencyResult(userId, idempotencyKey, trade.id);

  const fullTrade = await tradesService.getTrade(userId, trade.id);
  const body = { trade: toApiTradeDTO(fullTrade!), ...(warnings.length > 0 ? { warnings } : {}) };
  return withCors(request, NextResponse.json(body, { status: 201 }));
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
