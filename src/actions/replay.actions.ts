"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import {
  advanceReplayExecutionSchema,
  cancelReplayPendingSchema,
  closeReplayPartialSchema,
  closeReplayRemainingSchema,
  createManualComparisonLinkSchema,
  createReplayDecisionSchema,
  createReplayReviewSessionSchema,
  deleteManualComparisonLinkSchema,
  getReplayCandlesSchema,
  moveReplayStopLossSchema,
  resolveReplayAmbiguitySchema,
  setMissedOpportunityClassificationSchema,
  startReplayReviewForPeriodSchema,
  updateReplayProgressSchema,
  updateReplayReviewNotesSchema,
} from "@/lib/validation/replay";
import * as replayReviewService from "@/server/services/replay-review.service";
import * as replayTradeService from "@/server/services/replay-trade.service";
import * as replayComparisonLinkService from "@/server/services/replay-comparison-link.service";
import type { Candle } from "@/domain/market-data/candle";
import type { MarketDataError } from "@/domain/market-data/provider-types";
import type { HistoricalStrategyContextDTO, ReplayTradeDTO } from "@/types/replay";

type ActionResult = { success: true } | { success: false; error: string };
type CreateSessionResult = { success: true; id: string } | { success: false; error: string };
type CreateTradeResult = { success: true; id: string; trade: ReplayTradeDTO } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createReplayReviewSession(input: unknown): Promise<CreateSessionResult> {
  const user = await requireUser();
  const parsed = createReplayReviewSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const session = await replayReviewService.createReplayReviewSession(user.id, parsed.data);
    revalidatePath("/edge");
    return { success: true, id: session.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create review session.") };
  }
}

/**
 * "Start Replay Review" from inside Edge Review (Stage 12.5 §7) — find-or-
 * create the session for this exact period+scope, then immediately start it
 * (freezing the baseline). One click, no separate creation screen. Reusing
 * an already-started session here is a no-op on the baseline (see
 * startReplayReviewSession's own idempotency).
 */
export async function startReplayReviewForPeriod(input: unknown): Promise<CreateSessionResult> {
  const user = await requireUser();
  const parsed = startReplayReviewForPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const session = await replayReviewService.findOrCreateReplayReviewSessionForPeriod(user.id, parsed.data);
    await replayReviewService.startReplayReviewSession(user.id, session.id);
    revalidatePath("/edge");
    return { success: true, id: session.id };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to start review.") };
  }
}

export async function startReplayReviewSession(sessionId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await replayReviewService.startReplayReviewSession(user.id, sessionId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to start review.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

export async function completeReplayReviewSession(sessionId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await replayReviewService.completeReplayReviewSession(user.id, sessionId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to complete review.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

export async function updateReplayReviewNotes(sessionId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updateReplayReviewNotesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  try {
    await replayReviewService.updateReplayReviewNotes(user.id, sessionId, parsed.data.notes);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save notes.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

/** Creates a Replay decision — TAKEN (places a simulated order) or SKIPPED
 *  (Stage 14 §2, §27). */
export async function createReplayDecision(sessionId: string, input: unknown): Promise<CreateTradeResult> {
  const user = await requireUser();
  const parsed = createReplayDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const trade = await replayTradeService.createReplayDecision(user.id, sessionId, parsed.data);
    revalidatePath("/edge");
    return { success: true, id: trade.id, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create replay decision.") };
  }
}

/**
 * The frozen historical Strategy version + Setup Types valid AT a given
 * Replay clock instant (Stage 14 §3, §29) — the read path the decision form
 * uses to populate its Setup Type / checklist options. Never the live
 * Strategy Lab config (`loadEffectiveScenario` in
 * strategy-setup-types.actions.ts is a DIFFERENT, live-only read used by the
 * real Trade form). Returns null when no version predates `atTime` — the
 * form must surface that rather than silently falling back to anything live.
 */
export async function getReplayHistoricalStrategyContext(
  strategyId: string,
  atTime: number,
): Promise<HistoricalStrategyContextDTO | null> {
  const user = await requireUser();
  return replayReviewService.resolveHistoricalStrategyVersion(user.id, strategyId, atTime);
}

export async function deleteReplayTrade(sessionId: string, id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await replayTradeService.deleteReplayTrade(user.id, id);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove replay trade.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

type TradeResult = { success: true; trade: ReplayTradeDTO } | { success: false; error: string };

/**
 * Advances one ReplayTrade's simulated execution through newly revealed base
 * candles (Stage 14 §25) — called as the Replay Clock plays/steps forward
 * for the active TAKEN trade. A no-op for SKIPPED or already-closed trades.
 * Deliberately does NOT `revalidatePath` — the Replay Clock's play loop can
 * call this once per revealed candle, and forcing a server-cache
 * invalidation that often would be wasteful; the client updates its own
 * local state from the returned trade instead.
 */
export async function advanceReplayTradeExecution(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = advanceReplayExecutionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.advanceReplayTradeExecution(user.id, replayTradeId, parsed.data.candles);
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to advance replay execution.") };
  }
}

export async function resolveReplayTradeAmbiguity(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = resolveReplayAmbiguitySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.resolveReplayTradeAmbiguity(user.id, replayTradeId, parsed.data.resolution);
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to resolve ambiguous candle.") };
  }
}

export async function moveReplayTradeStopLoss(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = moveReplayStopLossSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.moveReplayTradeStopLoss(
      user.id,
      replayTradeId,
      parsed.data.newStopLoss,
      parsed.data.timestamp,
    );
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to move stop loss.") };
  }
}

export async function closeReplayTradePartialManually(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = closeReplayPartialSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.closeReplayTradePartialManually(
      user.id,
      replayTradeId,
      parsed.data.percent,
      parsed.data.price,
      parsed.data.timestamp,
    );
    revalidatePath("/edge");
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to close partial position.") };
  }
}

export async function closeReplayTradeRemainingManually(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = closeReplayRemainingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.closeReplayTradeRemainingManually(
      user.id,
      replayTradeId,
      parsed.data.price,
      parsed.data.timestamp,
    );
    revalidatePath("/edge");
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to close position.") };
  }
}

export async function cancelReplayTradePendingOrder(replayTradeId: string, input: unknown): Promise<TradeResult> {
  const user = await requireUser();
  const parsed = cancelReplayPendingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const trade = await replayTradeService.cancelReplayTradePendingOrder(user.id, replayTradeId, parsed.data.timestamp);
    revalidatePath("/edge");
    return { success: true, trade };
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to cancel pending order.") };
  }
}

export async function listReplayTrades(sessionId: string) {
  const user = await requireUser();
  return replayTradeService.listReplayTrades(user.id, sessionId);
}

/** Replay Clock resume checkpoint (Stage 13 §10) — called on pause/asset-
 *  switch/timeframe-switch/unmount, never per animation frame. */
export async function updateReplayProgress(sessionId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = updateReplayProgressSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await replayReviewService.updateReplayProgress(user.id, sessionId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save progress.") };
  }
  return { success: true };
}

type CandlesResult = { success: true; candles: Candle[]; sourceLabel: string | null } | { success: false; error: MarketDataError };

/** Stage 17B §18 — a short, honest label for the dev-safety data-source
 *  indicator ("Data: Databento · ESZ6" vs "Data: Synthetic Fixture"),
 *  derived from whichever segment was actually fetched LAST (the one
 *  closest to the requested range's end) — never guessed, never leaking
 *  more than a provider name + literal contract symbol into the UI. */
function buildSourceLabel(provenance: { providerId: string; segments: { contractSymbol: string }[] }[]): string | null {
  const last = provenance[provenance.length - 1];
  if (!last) return null;
  if (last.providerId === "fixture") return "Synthetic Fixture";
  const lastSegment = last.segments[last.segments.length - 1];
  return lastSegment ? `Databento · ${lastSegment.contractSymbol}` : "Databento";
}

/**
 * Fetches a chunk of historical candles for the Replay chart (Stage 13 §8,
 * chunking reworked Stage 17B §23-24) — the client calls this on demand for
 * a small day/week-sized window at a time (see
 * `domain/market-data/replay-prefetch-window.ts`), never the whole review
 * period in one response, and never receives more than it asked for. This
 * is the ONLY way candle data reaches the browser; the no-hindsight filter
 * (visible-candles.ts) is then applied client-side against the Replay
 * Clock's `currentTime` before anything is rendered — fetching ahead is
 * allowed, revealing is not (§20). `sessionId` pins market-data provenance
 * (§13) — see `replay-review.service.ts`'s `fetchReplayCandlesWithProvenance`.
 */
export async function getReplayCandles(input: unknown): Promise<CandlesResult> {
  const user = await requireUser();
  const parsed = getReplayCandlesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: { code: "PROVIDER_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input." } };
  }

  const result = await replayReviewService.fetchReplayCandlesWithProvenance(
    user.id,
    parsed.data.sessionId,
    parsed.data.canonicalSymbol,
    parsed.data.from,
    parsed.data.to,
  );
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, candles: result.candles, sourceLabel: buildSourceLabel(result.provenance) };
}

// ── Comparison (Stage 15.2) ─────────────────────────────────────────────────

/** Manually confirm/correct an Actual-vs-Replay pairing (§2, §16). */
export async function createManualComparisonLink(sessionId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createManualComparisonLinkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await replayComparisonLinkService.createManualComparisonLink(user.id, sessionId, parsed.data);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save the match correction.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

/** Remove/reset a manual match correction, returning that pair to the
 *  algorithm's own auto-matching. */
export async function deleteManualComparisonLink(sessionId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = deleteManualComparisonLinkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await replayComparisonLinkService.deleteComparisonLinkForPair(user.id, sessionId, parsed.data.actualTradeId, parsed.data.replayTradeId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to remove the match correction.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

/** Confirm/reject a Potential Missed Opportunity (§5). Never mutates Trade
 *  or ReplayTrade — persisted only as a `ReplayComparisonLink`. */
export async function setMissedOpportunityClassification(sessionId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = setMissedOpportunityClassificationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await replayComparisonLinkService.setMissedOpportunityClassification(
      user.id,
      sessionId,
      parsed.data.replayTradeId,
      parsed.data.classification,
    );
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to save the classification.") };
  }
  revalidatePath("/edge");
  return { success: true };
}

/** COMPLETED → IN_PROGRESS (§26) — an explicit, controlled action; never
 *  implicit in any other write path. */
export async function reopenReplayReviewSession(sessionId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await replayReviewService.reopenReplayReviewSession(user.id, sessionId);
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to reopen the review.") };
  }
  revalidatePath("/edge");
  return { success: true };
}
