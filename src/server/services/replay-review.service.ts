import { Prisma, type ReplayReviewSession } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import {
  getCanonicalAnalyticsDataset,
  summarizeCanonicalAnalytics,
} from "@/server/services/analytics-canonical.service";
import { getOpportunityInputs } from "@/server/services/opportunity.service";
import { summarizeOpportunities } from "@/domain/analytics/opportunity-engine";
import { getStrategyVersion } from "@/server/services/strategies.service";
import { validateReviewPeriod } from "@/domain/replay/review-period";
import { pickVersionAtTime } from "@/domain/replay/historical-strategy-version";
import * as metrics from "@/domain/performance/metrics";
import { summarizePsychologyAdherence, toMetricInputs } from "@/domain/analytics/canonical-aggregations";
import { buildActualTradeComparisonSnapshot } from "@/domain/replay/actual-trade-comparison-snapshot";
import { getHistoricalCandles, getProviderById, isProviderDisplayPermitted, resolveMarketDataProvider } from "@/server/services/market-data.service";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { CreateReplayReviewSessionInput } from "@/lib/validation/replay";
import type { Candle } from "@/domain/market-data/candle";
import type { CandleProvenance, FetchCandlesResult, HistoricalMarketDataProvider } from "@/domain/market-data/provider-types";
import type {
  ActualTradeComparisonSnapshot,
  ActualTradeRefDTO,
  HistoricalStrategyContextDTO,
  MarketDataProvenanceMap,
  ReplayActualBaseline,
  ReplayReviewSessionDTO,
  ReplaySessionListItemDTO,
  ReplayReviewType,
  StoredMarketDataProvenance,
} from "@/types/replay";

/**
 * Replay foundation (Stage 12) — ReplayReviewSession CRUD, the frozen ACTUAL
 * baseline builder, and historical Strategy context. See the schema's own
 * doc comments for the actual/replay boundary and baseline-freeze-at-start
 * decision; this file is where that decision is actually implemented.
 */

const sessionWithStrategy = { strategy: { select: { name: true } } } as const;
type SessionRow = ReplayReviewSession & { strategy: { name: string } | null };

function toListItemDTO(row: SessionRow): ReplaySessionListItemDTO {
  const baseline = row.actualBaselineSnapshot as unknown as ReplayActualBaseline | null;
  return {
    id: row.id,
    reviewType: row.reviewType,
    startDate: utcDateToKey(row.startDate),
    endDate: utcDateToKey(row.endDate),
    status: row.status,
    strategyName: row.strategy?.name ?? null,
    assetSymbols: row.assetSymbols,
    totalRealizedR: baseline?.canonical.overview.totalRealizedR ?? null,
    winRate: baseline?.canonical.overview.winRate ?? null,
    executedTrades: baseline?.canonical.overview.totalExecutedTrades ?? null,
  };
}

function toSessionDTO(row: SessionRow): ReplayReviewSessionDTO {
  return {
    id: row.id,
    reviewType: row.reviewType,
    startDate: utcDateToKey(row.startDate),
    endDate: utcDateToKey(row.endDate),
    status: row.status,
    strategyId: row.strategyId,
    strategyName: row.strategy?.name ?? null,
    assetSymbols: row.assetSymbols,
    notes: row.notes,
    actualBaselineSnapshot: row.actualBaselineSnapshot as unknown as ReplayActualBaseline | null,
    replayResumePoint:
      row.replayCurrentTime && row.replayCurrentAsset && row.replayCurrentTimeframe
        ? {
            currentTime: row.replayCurrentTime.getTime(),
            asset: row.replayCurrentAsset,
            timeframe: row.replayCurrentTimeframe,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    reviewFinalizedAt: row.reviewFinalizedAt?.toISOString() ?? null,
    marketDataProvenance: (row.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? null,
  };
}

/**
 * Re-validates the period even though the Zod schema (action layer) already
 * does — this service is also called directly by other server code/tests,
 * and a review's date range is exactly the kind of invariant that must hold
 * regardless of caller (defense in depth, not just at the HTTP boundary).
 */
export async function createReplayReviewSession(
  userId: string,
  input: CreateReplayReviewSessionInput,
): Promise<ReplayReviewSessionDTO> {
  const periodCheck = validateReviewPeriod(input.reviewType, input.startDate, input.endDate);
  if (!periodCheck.valid) throw new Error(periodCheck.error ?? "Invalid review period.");

  if (input.strategyId) {
    const owned = await prisma.strategy.findFirst({ where: { id: input.strategyId, userId }, select: { id: true } });
    if (!owned) throw new Error("Strategy not found.");
  }

  const assetSymbols = [...new Set((input.assetSymbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))];

  const row = await prisma.replayReviewSession.create({
    data: {
      userId,
      reviewType: input.reviewType,
      startDate: dateKeyToUtcDate(input.startDate),
      endDate: dateKeyToUtcDate(input.endDate),
      strategyId: input.strategyId ?? null,
      assetSymbols,
    },
    include: sessionWithStrategy,
  });
  return toSessionDTO(row);
}

export async function listReplayReviewSessions(userId: string): Promise<ReplaySessionListItemDTO[]> {
  const rows = await prisma.replayReviewSession.findMany({
    where: { userId },
    include: sessionWithStrategy,
    orderBy: { startDate: "desc" },
  });
  return rows.map(toListItemDTO);
}

export async function getReplayReviewSession(userId: string, id: string): Promise<ReplayReviewSessionDTO | null> {
  const row = await prisma.replayReviewSession.findFirst({ where: { id, userId }, include: sessionWithStrategy });
  return row ? toSessionDTO(row) : null;
}

const enrichmentInclude = {
  performanceRiskSnapshot: { select: { initialStop: true, realizedR: true, performancePnl: true, settledAt: true } },
  actualPartialExits: { select: { exitOrder: true, exitPrice: true, percentClosed: true, exitedAt: true, realizedR: true } },
  behaviourLabels: { include: { behaviourLabel: { select: { name: true, polarity: true } } } },
  planVersions: {
    orderBy: { versionNumber: "desc" as const },
    take: 1,
    select: { entry: true, stopLoss: true, weightedPlannedR: true, targetsSnapshot: true },
  },
} as const;

/**
 * Stage 15.1 §9 — ONE batched query (`id IN (...)`) for every trade already
 * resolved by the canonical dataset, never N+1. Deliberately separate from
 * `getCanonicalAnalyticsDataset`'s own query (§8 — this richer evidence
 * belongs to Edge Review's baseline, not the shared canonical model that
 * every other Analytics view also reads).
 */
async function fetchActualTradeComparisonSnapshots(userId: string, tradeIds: string[]): Promise<ActualTradeComparisonSnapshot[]> {
  if (tradeIds.length === 0) return [];

  const trades = await prisma.trade.findMany({
    where: { userId, id: { in: tradeIds } },
    include: enrichmentInclude,
  });

  return trades.map((t) => {
    const confirmedPlan = t.planVersions[0]
      ? {
          entry: t.planVersions[0].entry?.toNumber() ?? null,
          stopLoss: t.planVersions[0].stopLoss?.toNumber() ?? null,
          weightedPlannedR: t.planVersions[0].weightedPlannedR?.toNumber() ?? null,
          targetsSnapshot: t.planVersions[0].targetsSnapshot,
        }
      : null;

    return buildActualTradeComparisonSnapshot({
      tradeId: t.id,
      dateKey: utcDateToKey(t.tradeDate),
      createdAt: t.createdAt,
      tradeDate: t.tradeDate,
      executionMinutes: t.executionMinutes,
      closedAt: t.closedAt,
      direction: t.direction,
      assetSymbol: t.assetSymbol,
      session: t.selectedSession,
      strategyId: t.strategyId,
      strategyName: t.strategyNameSnapshot,
      strategyVersion: t.strategyVersionSnapshot,
      validationState: t.validationState,
      overrideReason: t.overrideReason,
      overrideNote: t.overrideNote,
      setupValidationSnapshot: t.setupValidationSnapshot as unknown as SetupValidationSnapshot | null,
      dailyBiasSnapshot: t.dailyBiasSnapshot as "LONG" | "SHORT" | "NEUTRAL" | null,
      reviewLifecycleStatus: t.reviewLifecycleStatus,
      plannedR: t.expectedRR?.toNumber() ?? null,
      actualRR: t.actualRR?.toNumber() ?? null,
      actualEntry: t.actualEntry?.toNumber() ?? null,
      actualStopLoss: t.actualStopLoss?.toNumber() ?? null,
      actualExit: t.actualExit?.toNumber() ?? null,
      resolvedInitialStop: t.performanceRiskSnapshot?.initialStop?.toNumber() ?? null,
      legacyPlannedEntry: t.plannedEntry?.toNumber() ?? null,
      legacyPlannedStopLoss: t.plannedStopLoss?.toNumber() ?? null,
      legacyPlannedTarget: t.plannedTarget?.toNumber() ?? null,
      confirmedPlan,
      actualPartialExits: t.actualPartialExits.map((p) => ({
        exitOrder: p.exitOrder,
        exitPrice: p.exitPrice.toNumber(),
        percentClosed: p.percentClosed?.toNumber() ?? null,
        exitedAt: p.exitedAt,
        realizedR: p.realizedR?.toNumber() ?? null,
      })),
      settled: t.performanceRiskSnapshot?.settledAt != null,
      settledRealizedR: t.performanceRiskSnapshot?.realizedR?.toNumber() ?? null,
      settledPnl: t.performanceRiskSnapshot?.performancePnl?.toNumber() ?? null,
      preTradeMoodTags: t.preTradeMoodTags,
      preTradeMoodIntensity: t.preTradeMoodIntensity,
      tradeIntent: t.tradeIntent,
      behaviourLabels: t.behaviourLabels
        .filter((l) => l.behaviourLabel != null)
        .map((l) => ({ name: l.behaviourLabel.name, polarity: l.behaviourLabel.polarity })),
    });
  });
}

/**
 * ACTUAL baseline (Stage 12 §6-7, enriched Stage 15.1) — built ONCE from the
 * same canonical (R-primary) dataset/aggregators normal trader Analytics
 * uses, plus the existing Opportunity engine, plus (Stage 15.1) a richer
 * per-trade comparison snapshot batched in one extra query. Never a second
 * performance engine, never contribution-% math. Exported (not just called
 * internally) so tests and a future "resync baseline" action can call it
 * directly.
 */
export async function buildActualBaseline(
  userId: string,
  params: { startDate: string; endDate: string; strategyId?: string | null; assetSymbols: string[] },
): Promise<ReplayActualBaseline> {
  const allRows = await getCanonicalAnalyticsDataset(userId, {
    from: params.startDate,
    to: params.endDate,
    strategyId: params.strategyId ?? undefined,
  });
  const rows =
    params.assetSymbols.length > 0
      ? allRows.filter((r) => params.assetSymbols.includes(r.assetSymbol))
      : allRows;

  const canonical = summarizeCanonicalAnalytics(rows);
  const averageRealizedR = metrics.averageRR(toMetricInputs(rows));
  const psychologyAdherence = summarizePsychologyAdherence(rows);
  const actualTrades: ActualTradeRefDTO[] = rows.map((r) => ({
    tradeId: r.tradeId,
    dateKey: r.dateKey,
    assetSymbol: r.assetSymbol,
    direction: r.direction,
    strategyName: r.strategyName,
    setupTypeName: r.setupTypeName,
    validationState: r.validationState,
    reviewLifecycleStatus: r.reviewLifecycleStatus,
    isCancelled: r.isCancelled,
    winLossClass: r.winLossClass,
    realizedR: r.realizedR,
    finalizedR: r.finalizedR,
    pnl: r.pnl,
  }));

  const [opportunityInputs, strategy, actualTradeSnapshots] = await Promise.all([
    getOpportunityInputs(userId, dateKeyToUtcDate(params.startDate), dateKeyToUtcDate(params.endDate)),
    params.strategyId
      ? prisma.strategy.findFirst({ where: { id: params.strategyId, userId }, select: { name: true } })
      : Promise.resolve(null),
    fetchActualTradeComparisonSnapshots(userId, rows.map((r) => r.tradeId)),
  ]);

  return {
    computedAt: new Date().toISOString(),
    range: { startDate: params.startDate, endDate: params.endDate },
    scope: {
      strategyId: params.strategyId ?? null,
      strategyName: strategy?.name ?? null,
      assetSymbols: params.assetSymbols,
    },
    canonical,
    averageRealizedR,
    psychologyAdherence,
    opportunity: {
      hasData: opportunityInputs.length > 0,
      summary: summarizeOpportunities(opportunityInputs),
    },
    actualTrades,
    schemaVersion: 2,
    actualTradeSnapshots,
  };
}

/**
 * Read-only lookup for "the review session covering this exact period and
 * scope" (Stage 12.5 §7-8) — Edge Review resolves its session this way
 * instead of the trader ever visiting a separate creation flow. Scope
 * equality is checked in application code (not a DB unique constraint):
 * Postgres treats every NULL as distinct from every other NULL, so a plain
 * unique index on `strategyId` could never actually prevent two "All
 * Trading" (strategyId = null) sessions for the same period — this lookup
 * (used by every write path below) is what keeps that from happening.
 */
export async function findReplayReviewSessionForPeriod(
  userId: string,
  params: { reviewType: ReplayReviewType; startDate: string; endDate: string; strategyId?: string | null; assetSymbols?: string[] },
): Promise<ReplayReviewSessionDTO | null> {
  const candidates = await prisma.replayReviewSession.findMany({
    where: {
      userId,
      reviewType: params.reviewType,
      startDate: dateKeyToUtcDate(params.startDate),
      endDate: dateKeyToUtcDate(params.endDate),
    },
    include: sessionWithStrategy,
  });

  const wantedAssets = [...(params.assetSymbols ?? [])].sort();
  const match = candidates.find((c) => {
    if ((c.strategyId ?? null) !== (params.strategyId ?? null)) return false;
    const haveAssets = [...c.assetSymbols].sort();
    return haveAssets.length === wantedAssets.length && haveAssets.every((a, i) => a === wantedAssets[i]);
  });
  return match ? toSessionDTO(match) : null;
}

/**
 * Find-or-create for the same (period, scope) — this is what "Start Replay
 * Review" inside Edge Review calls (Stage 12.5 §7), so the trader never
 * creates a session from a separate screen. Returns the existing session
 * untouched if one already covers this exact period+scope (duplicate
 * prevention), otherwise creates a new DRAFT one.
 */
export async function findOrCreateReplayReviewSessionForPeriod(
  userId: string,
  params: { reviewType: ReplayReviewType; startDate: string; endDate: string; strategyId?: string | null; assetSymbols?: string[] },
): Promise<ReplayReviewSessionDTO> {
  const existing = await findReplayReviewSessionForPeriod(userId, params);
  if (existing) return existing;
  return createReplayReviewSession(userId, {
    reviewType: params.reviewType,
    startDate: params.startDate,
    endDate: params.endDate,
    strategyId: params.strategyId ?? null,
    assetSymbols: params.assetSymbols ?? [],
  });
}

/**
 * DRAFT → IN_PROGRESS. Freezes the ACTUAL baseline at this exact moment —
 * this is the "started reviewing" instant the schema doc comment describes.
 * Idempotent: calling it again on an already-started session is a no-op
 * (the baseline is never silently recomputed once frozen).
 */
export async function startReplayReviewSession(userId: string, id: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id, userId } });
  if (!session) throw new Error("Review session not found.");
  if (session.status !== "DRAFT") return;

  const baseline = await buildActualBaseline(userId, {
    startDate: utcDateToKey(session.startDate),
    endDate: utcDateToKey(session.endDate),
    strategyId: session.strategyId,
    assetSymbols: session.assetSymbols,
  });

  await prisma.replayReviewSession.update({
    where: { id },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      actualBaselineSnapshot: baseline as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function completeReplayReviewSession(userId: string, id: string): Promise<void> {
  const result = await prisma.replayReviewSession.updateMany({
    where: { id, userId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Review session not found or not in progress.");
}

/**
 * COMPLETED → IN_PROGRESS (Stage 15.2 §26) — the ONLY sanctioned way a
 * completed review's Replay data becomes mutable again. Every ReplayTrade
 * mutation entry point (replay-trade.service.ts's `assertSessionMutable`)
 * requires IN_PROGRESS, so simply re-opening the session is what unlocks
 * them; this function's only job is that one explicit, auditable status
 * flip (`completedAt` cleared back to null — a session is either completed
 * or it isn't, never "completed but also still completedAt-stamped from a
 * previous run"). Does NOT recompute or touch `actualBaselineSnapshot` —
 * the frozen Actual baseline is untouched by Replay's own lifecycle.
 */
export async function reopenReplayReviewSession(userId: string, id: string): Promise<void> {
  const result = await prisma.replayReviewSession.updateMany({
    where: { id, userId, status: "COMPLETED" },
    // Reopening also revokes finalization (Stage 16 §27-28) — once Replay
    // can mutate again, any prior "I reviewed and signed off on this"
    // finalization stamp is no longer trustworthy. Commitments already
    // created stay exactly as they are (§21); only the finalization
    // timestamp itself is cleared, requiring an explicit re-finalize.
    data: { status: "IN_PROGRESS", completedAt: null, reviewFinalizedAt: null },
  });
  if (result.count === 0) throw new Error("Review session not found or not completed.");
}

/**
 * Stage 16 §26-27 — "Finish Review," DISTINCT from `completeReplayReviewSession`
 * above (see `reviewFinalizedAt`'s own doc comment on the schema for the
 * full rationale). Requires Replay to already be COMPLETED — a trader
 * cannot finalize a review whose Replay portion is still open/editable.
 * Idempotent: finalizing an already-finalized review is a no-op.
 */
export async function finalizeEdgeReview(userId: string, id: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id, userId }, select: { status: true, reviewFinalizedAt: true } });
  if (!session) throw new Error("Review session not found.");
  if (session.status !== "COMPLETED") throw new Error("Complete the Replay review before finishing Improvements.");
  if (session.reviewFinalizedAt) return;

  await prisma.replayReviewSession.update({ where: { id }, data: { reviewFinalizedAt: new Date() } });

  // Stage 19 §10-11 — runs exactly once per finalization (guarded by the
  // idempotency check above), deriving automatic evidence for this period
  // for any commitment with a deterministic rule mapping. Never blocks
  // finalization: a failure here must not prevent "Finish Review" from
  // completing, since evidence sync is a byproduct, not the trader action.
  const { syncSystemEvidenceForSession } = await import("@/server/services/edge-review-commitment.service");
  await syncSystemEvidenceForSession(userId, id).catch(() => undefined);
}

export async function updateReplayReviewNotes(userId: string, id: string, notes: unknown): Promise<void> {
  const result = await prisma.replayReviewSession.updateMany({
    where: { id, userId },
    data: { notes: notes == null ? Prisma.DbNull : (notes as Prisma.InputJsonValue) },
  });
  if (result.count === 0) throw new Error("Review session not found.");
}

/**
 * Replay Clock resume point (Stage 13 §10) — a CHECKPOINT write, called on
 * pause/asset-switch/timeframe-switch/navigating away, never on every
 * animation frame. Overwrites the previous checkpoint; there is only ever
 * one "where the trader left off" per session.
 */
export async function updateReplayProgress(
  userId: string,
  id: string,
  progress: { currentTime: number; asset: string; timeframe: string },
): Promise<void> {
  const result = await prisma.replayReviewSession.updateMany({
    where: { id, userId },
    data: {
      replayCurrentTime: new Date(progress.currentTime),
      replayCurrentAsset: progress.asset,
      replayCurrentTimeframe: progress.timeframe,
    },
  });
  if (result.count === 0) throw new Error("Review session not found.");
}

/**
 * Historical Strategy context (Stage 12 §8) — the immutable published
 * snapshot for the exact version a trade (or replay decision) was made
 * under. Returns null rather than falling back to the strategy's CURRENT
 * live config when no matching StrategyVersion exists (a pre-versioning
 * trade, or a version number that was never published) — never
 * misrepresenting today's Strategy Lab as the historical process.
 */
export async function getHistoricalStrategyContext(
  userId: string,
  strategyId: string,
  version: number,
): Promise<HistoricalStrategyContextDTO | null> {
  const result = await getStrategyVersion(userId, strategyId, version);
  if (!result) return null;
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { name: true } });
  return {
    strategyId,
    strategyName: strategy?.name ?? result.snapshot.name,
    version: result.version,
    createdAt: result.createdAt,
    note: result.note,
    snapshot: result.snapshot,
  };
}

/**
 * Historical StrategyVersion resolver (Stage 14 §3) — resolves which
 * published version was ACTUALLY valid at a given Replay clock instant,
 * using `pickVersionAtTime` (domain/replay/historical-strategy-version.ts)
 * over every version ever published for the strategy. Returns `null` when
 * no version predates `atTime` — the caller must surface this to the trader
 * rather than silently falling back to the strategy's current live config
 * (see that module's documented fallback policy).
 */
export async function resolveHistoricalStrategyVersion(
  userId: string,
  strategyId: string,
  atTime: number,
): Promise<HistoricalStrategyContextDTO | null> {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { name: true } });
  if (!strategy) return null;

  const versions = await prisma.strategyVersion.findMany({
    where: { strategyId },
    select: { version: true, note: true, createdAt: true, snapshot: true },
  });
  const picked = pickVersionAtTime(versions, atTime);
  if (!picked) return null;

  return {
    strategyId,
    strategyName: strategy.name,
    version: picked.version,
    createdAt: picked.createdAt.toISOString(),
    note: picked.note,
    snapshot: picked.snapshot as unknown as HistoricalStrategyContextDTO["snapshot"],
  };
}

// ── Market-data provenance (Stage 17B §11-13) ───────────────────────────────

function mergeProvenance(
  existing: StoredMarketDataProvenance | undefined,
  fetched: CandleProvenance[],
): StoredMarketDataProvenance | null {
  if (fetched.length === 0) return existing ?? null;

  const segments = existing ? [...existing.segments] : [];
  for (const p of fetched) {
    for (const seg of p.segments) {
      const isDuplicate = segments.some(
        (s) => s.contractSymbol === seg.contractSymbol && s.from === seg.from && s.to === seg.to,
      );
      if (!isDuplicate) segments.push(seg);
    }
  }
  segments.sort((a, b) => a.from - b.from);

  return {
    // Freeze-once (§13): the FIRST provider/dataset/priceBasis this session
    // ever recorded for this asset wins, even if `fetched` disagrees — it
    // never should, since the provider used to produce `fetched` is always
    // the one already pinned by `fetchReplayCandlesWithProvenance` below,
    // but this makes the freeze explicit rather than incidental.
    providerId: existing?.providerId ?? fetched[0].providerId,
    datasetId: existing?.datasetId ?? fetched[0].datasetId,
    priceBasis: existing?.priceBasis ?? fetched[0].priceBasis,
    retrievedAt: fetched[fetched.length - 1].retrievedAt,
    segments,
    frozenAt: existing?.frozenAt ?? new Date().toISOString(),
  };
}

async function recordMarketDataProvenance(sessionId: string, canonicalSymbol: string, fetched: CandleProvenance[]): Promise<void> {
  if (fetched.length === 0) return;
  const row = await prisma.replayReviewSession.findUnique({ where: { id: sessionId }, select: { marketDataProvenance: true } });
  if (!row) return;
  const map = { ...((row.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {}) };
  const merged = mergeProvenance(map[canonicalSymbol], fetched);
  if (!merged) return;
  map[canonicalSymbol] = merged;
  await prisma.replayReviewSession.update({
    where: { id: sessionId },
    data: { marketDataProvenance: map as unknown as Prisma.InputJsonValue },
  });
}

/**
 * The ONLY path Replay's candle-fetching should go through once a session
 * exists (Stage 17B §13, corrected Stage 17B.1 §10/§11) — enforces
 * freeze-once: the first provider ever used for a given asset in this
 * session is pinned for the rest of the session's life, never silently
 * re-resolved from current config and never automatically substituted if
 * that provider later becomes unavailable (surfaces a clear
 * `PROVIDER_ERROR` instead — see the schema's own doc comment on
 * `marketDataProvenance`). Freeze-once covers WHICH provider a session
 * used, historically — it does NOT override current licensing policy: a
 * session pinned to a licensed provider (Databento or, since Stage 17C.2,
 * Twelve Data) while that provider's own display flag is later turned off
 * gets a `PROVIDER_DISPLAY_DISABLED` refusal, not a silent Fixture fallback
 * and not an override of the disabled flag. Its provenance record is
 * untouched either way. This function is fully provider-agnostic — adding
 * Twelve Data required zero changes here, only a second entry in
 * `market-data.service.ts`'s `getProviderById`/`resolveMarketDataProvider`/
 * `isProviderDisplayPermitted`.
 */
export async function fetchReplayCandlesWithProvenance(
  userId: string,
  sessionId: string,
  canonicalSymbol: string,
  from: number,
  to: number,
): Promise<{ ok: true; candles: Candle[]; provenance: CandleProvenance[] } | Extract<FetchCandlesResult, { ok: false }>> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { marketDataProvenance: true },
  });
  if (!session) {
    return { ok: false, error: { code: "PROVIDER_ERROR", message: "Replay review session not found." } };
  }

  const map = (session.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {};
  const existing = map[canonicalSymbol];

  let provider: HistoricalMarketDataProvider;
  if (existing) {
    const pinned = getProviderById(existing.providerId);
    if (!pinned) {
      return {
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          message: `This session's ${canonicalSymbol} data was originally sourced from an unrecognized provider ("${existing.providerId}").`,
        },
      };
    }
    if (!pinned.isAvailable()) {
      return {
        ok: false,
        error: {
          code: "PROVIDER_ERROR",
          message: `This session's ${canonicalSymbol} data came from ${pinned.displayName}, which is no longer configured. Restore its credentials to keep replaying this asset — Traditorium never silently switches data sources mid-session.`,
        },
      };
    }
    // Stage 17B.1 §10/§11 (extended Stage 17C.2 §21) — historical
    // provenance staying frozen does NOT override current licensing
    // policy. A session pinned to a licensed/gated provider (Databento or
    // Twelve Data) whose display is currently disabled gets a structured,
    // non-destructive refusal: the frozen provenance record is left
    // untouched (no write happens below), no fetch is attempted, and there
    // is no silent fallback to Fixture or any
    // other provider substitution.
    if (!isProviderDisplayPermitted(pinned.id)) {
      return {
        ok: false,
        error: {
          code: "PROVIDER_DISPLAY_DISABLED",
          message: `This session's ${canonicalSymbol} data is sourced from ${pinned.displayName}, which is currently disabled for display (licensing policy). The original provenance is preserved — it will resume once display is re-enabled.`,
        },
      };
    }
    provider = pinned;
  } else {
    provider = resolveMarketDataProvider(canonicalSymbol);
  }

  const result = await getHistoricalCandles(canonicalSymbol, from, to, provider);
  if (!result.ok) return result;
  await recordMarketDataProvenance(sessionId, canonicalSymbol, result.provenance);
  return { ok: true, candles: result.candles, provenance: result.provenance };
}
