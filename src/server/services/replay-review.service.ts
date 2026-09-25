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
import { MT5_IMPORTED_PROVIDER_ID } from "@/server/services/market-data/mt5-imported-provider";
import { getMt5Import, listMt5Imports, type MarketDataImportSummaryDTO } from "@/server/services/mt5-import.service";
import { visibleCandles } from "@/domain/market-data/visible-candles";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { CreateReplayReviewSessionInput } from "@/lib/validation/replay";
import type { Candle } from "@/domain/market-data/candle";
import type { CandleProvenance, FetchCandlesResult, HistoricalMarketDataProvider } from "@/domain/market-data/provider-types";
import { timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";
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
const DAY_MS = 86_400_000;

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
 *
 * Strict no-future-candle delivery (Prompt 5 §5/§18) — this is NO LONGER
 * the mechanism that can EXTEND how much of a review a session is allowed
 * to see; only `advanceReplayClock`'s validated search can do that (it
 * independently re-derives the new boundary from real provider data, never
 * trusts a client-supplied instant directly). This function's own
 * `currentTime` write is therefore clamped to NEVER exceed whatever is
 * already the session's authoritative boundary — a resume-point checkpoint
 * can move backward (retreating/pausing somewhere already-revealed) or stay
 * put, but calling this directly can never be used to sneak the boundary
 * forward and bypass the validated advance path. Also clamped to the
 * review period itself, so a corrupted or malicious value can never persist
 * as the resume point either.
 */
export async function updateReplayProgress(
  userId: string,
  id: string,
  progress: { currentTime: number; asset: string; timeframe: string },
): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id, userId },
    select: { startDate: true, endDate: true },
  });
  if (!session) throw new Error("Review session not found.");

  const periodStart = session.startDate.getTime();
  const periodEnd = session.endDate.getTime() + DAY_MS - 1;
  const requested = Math.min(Math.max(progress.currentTime, periodStart), periodEnd);

  // Prompt 7 §10 hardening — a read-then-write clamp (read
  // `replayCurrentTime`, compute a clamped value in application code, write
  // it back) has a genuine race: a CONCURRENT `advanceReplayClock` call can
  // write a NEW, higher boundary in between this function's own read and
  // write, and this write would then silently overwrite that higher,
  // legitimately-advanced value with a stale, smaller one — PROVEN by a
  // regression test (Promise.all-raced advance + progress update). Fixed
  // by folding the clamp into a single atomic UPDATE: `LEAST(..., COALESCE
  // ("replayCurrentTime", periodStart))` reads the row's OWN current value
  // at the moment Postgres actually performs the write (which takes a row
  // lock for the statement's duration), never a value read moments earlier
  // in application code — there is no gap for a concurrent write to land in.
  const result = await prisma.$executeRaw`
    UPDATE "ReplayReviewSession"
    SET "replayCurrentTime" = LEAST(${new Date(requested)}::timestamp, COALESCE("replayCurrentTime", ${new Date(periodStart)}::timestamp)),
        "replayCurrentAsset" = ${progress.asset},
        "replayCurrentTimeframe" = ${progress.timeframe},
        "updatedAt" = NOW()
    WHERE "id" = ${id} AND "userId" = ${userId}
  `;
  if (result === 0) throw new Error("Review session not found.");
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
 * `isProviderDisplayPermitted`. Stage 21.3B's MT5 Imported provider needed
 * one small addition here (passing `userId` into `getProviderById`, since
 * unlike a vendor feed it's constructed per-user) — everything else about
 * this function is unchanged and still fully provider-agnostic.
 */
/**
 * Freeze-once provider resolution, factored out of `fetchReplayCandlesWithProvenance`
 * so the SAME rule (pinned provenance wins, licensing-gate still applies,
 * never auto-selects MT5) governs every path that can touch candle data —
 * including the strict-visibility `advanceReplayClock` below (Prompt 5
 * §17: "implement the visibility boundary at a provider-independent layer
 * wherever possible... do not add four separate implementations"). Pure
 * resolution only; callers decide what range to actually fetch.
 */
function resolvePinnedOrAutomaticProvider(
  userId: string,
  canonicalSymbol: string,
  provenanceMap: MarketDataProvenanceMap,
): { ok: true; provider: HistoricalMarketDataProvider } | Extract<FetchCandlesResult, { ok: false }> {
  const existing = provenanceMap[canonicalSymbol];
  if (!existing) {
    return { ok: true, provider: resolveMarketDataProvider(canonicalSymbol) };
  }

  // Stage 21.3B §4, extended Edge Review Replay Data Source §14/§15 —
  // `userId`/`importId` are only ever consulted when
  // `existing.providerId === "mt5-imported"`; every other provider id
  // ignores them (see `getProviderById`'s own doc comment). Passing
  // `existing.datasetId` back in here is what keeps a session pinned to
  // the EXACT `MarketDataImport` a trader explicitly selected — without
  // it, every subsequent candle request would silently fall back to the
  // provider's default "merge every overlapping import" behavior instead
  // of staying on that one chosen dataset.
  const pinned = getProviderById(existing.providerId, { userId, importId: existing.datasetId });
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
  // is no silent fallback to Fixture or any other provider substitution.
  if (!isProviderDisplayPermitted(pinned.id)) {
    return {
      ok: false,
      error: {
        code: "PROVIDER_DISPLAY_DISABLED",
        message: `This session's ${canonicalSymbol} data is sourced from ${pinned.displayName}, which is currently disabled for display (licensing policy). The original provenance is preserved — it will resume once display is re-enabled.`,
      },
    };
  }
  return { ok: true, provider: pinned };
}

/**
 * Strict no-future-candle delivery (Prompt 5 §3-5) — the SERVER, not
 * `visible-candles.ts`, is now the PRIMARY boundary: this function never
 * returns a candle beyond the session's own AUTHORITATIVE
 * `replayCurrentTime` (§5's "preferred architecture" — the persisted
 * cursor already exists on `ReplayReviewSession`, no schema change
 * needed), regardless of what `to` a caller requests. This function is
 * READ-ONLY with respect to that boundary — it can serve MORE of the
 * ALREADY-authorized history (e.g. rebuilding client state after a
 * reload, §23) but can NEVER extend how far a session may see; only
 * `advanceReplayClock` below can do that, deliberately, via its own
 * validated search. Reuses `visibleCandles` — the EXACT SAME
 * closed-candle rule `visible-candles.ts` already defines and tests
 * client-side — so there is one single definition of "visible" for the
 * whole app, applied here as the primary boundary and left in place
 * client-side purely as defense-in-depth (§20). See that module's own
 * doc comment for the exact rule.
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
    select: { marketDataProvenance: true, startDate: true, endDate: true, replayCurrentTime: true },
  });
  if (!session) {
    return { ok: false, error: { code: "PROVIDER_ERROR", message: "Replay review session not found." } };
  }

  const periodStart = session.startDate.getTime();
  const periodEnd = session.endDate.getTime() + DAY_MS - 1;
  // The trusted boundary — NEVER the client's own `to`. A session that has
  // never advanced yet (replayCurrentTime still null) has authorized
  // nothing past periodStart.
  const visibilityBoundary = session.replayCurrentTime ? Math.min(session.replayCurrentTime.getTime(), periodEnd) : periodStart;

  const clampedFrom = Math.max(from, periodStart);
  const clampedTo = Math.min(to, visibilityBoundary);
  if (clampedFrom > clampedTo) return { ok: true, candles: [], provenance: [] };

  const map = (session.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {};
  const resolved = resolvePinnedOrAutomaticProvider(userId, canonicalSymbol, map);
  if (!resolved.ok) return resolved;

  const result = await getHistoricalCandles(canonicalSymbol, clampedFrom, clampedTo, resolved.provider);
  if (!result.ok) return result;
  const safeCandles = visibleCandles(result.candles, visibilityBoundary, "1m");
  // Prompt 6 §20 fix — a provider's OWN provenance segments record what it
  // QUERIED, not what actually became visible (a day-granular provider
  // fetch happens regardless of whether the request's sliver of that day
  // survives the strict visibility filter above). Recording provenance for
  // a fetch that revealed ZERO candles falsely "consumes" this asset's
  // provenance — `isProvenanceConsumed`'s freeze-once lock (§16) would then
  // refuse MT5 dataset selection before the trader ever saw a single
  // candle, simply because the read-only history-refill effect ran once on
  // mount. Only recording provenance when something real was actually
  // revealed keeps "consumed" meaning what it says.
  if (safeCandles.length > 0) await recordMarketDataProvenance(sessionId, canonicalSymbol, result.provenance);
  return { ok: true, candles: safeCandles, provenance: result.provenance };
}

/**
 * Strict no-future-candle delivery (Prompt 5 §5/§6/§10) — the ONLY function
 * that may EXTEND a session's authoritative `replayCurrentTime` forward,
 * i.e. the narrow "advance" primitive §6 asks for (covers Step/Play/seek/
 * jump-to-start/day-nav — all of them are just "move the boundary forward
 * to some target instant," differing only in how far the CLIENT chooses to
 * ask for in one call). `requestedTime` is a target, never trusted
 * directly: it is clamped to `[currentBoundary, periodEnd]` — it can never
 * move the boundary BACKWARD (that stays `updateReplayProgress`'s job) and
 * can never escape the review period, satisfying §15 even though the
 * underlying MT5/vendor dataset may cover a wider range. Returns exactly
 * the newly-permitted candles (those that were not yet visible under the
 * OLD boundary), reusing the same `visibleCandles` rule as the read path
 * above — one definition of "visible," one place either function can ever
 * disagree about it: nowhere.
 */
export async function advanceReplayClock(
  userId: string,
  sessionId: string,
  canonicalSymbol: string,
  requestedTime: number,
  /** The trader's current DISPLAY timeframe — this function always fetches
   *  at base (1m) granularity regardless, but keeps the session's resume
   *  point (§23 — reload/persistence) fully populated alongside
   *  `replayCurrentTime` so `replayResumePoint` is never left null after
   *  the very first advance. Defaults to "1m" when the caller doesn't
   *  have a more specific one yet (e.g. the very first bootstrap call). */
  timeframe: string = "1m",
): Promise<{ ok: true; candles: Candle[]; provenance: CandleProvenance[]; currentTime: number } | Extract<FetchCandlesResult, { ok: false }>> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { marketDataProvenance: true, startDate: true, endDate: true, replayCurrentTime: true },
  });
  if (!session) {
    return { ok: false, error: { code: "PROVIDER_ERROR", message: "Replay review session not found." } };
  }

  const periodStart = session.startDate.getTime();
  const periodEnd = session.endDate.getTime() + DAY_MS - 1;
  const oldBoundaryRead = session.replayCurrentTime ? Math.min(session.replayCurrentTime.getTime(), periodEnd) : periodStart;
  const requestedClamped = Math.min(requestedTime, periodEnd);

  const map = (session.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {};
  const resolved = resolvePinnedOrAutomaticProvider(userId, canonicalSymbol, map);
  if (!resolved.ok) return resolved;

  if (requestedClamped <= oldBoundaryRead) {
    // Nothing new to reveal (a no-op advance, e.g. requestedTime <= oldBoundary).
    return { ok: true, candles: [], provenance: [], currentTime: oldBoundaryRead };
  }

  // Prompt 7 §7/§8 hardening — fetch BEFORE writing. A provider/R2 failure
  // (bad symbol, network outage, storage unavailable) must leave the
  // authoritative boundary COMPLETELY untouched — a real regression this
  // test suite caught: writing the boundary first and fetching second let
  // a failed fetch still advance `replayCurrentTime` to the requested
  // target, so a retry after recovery would find the boundary already
  // "there" and skip re-fetching the very data that was never actually
  // retrieved. `fetchFrom` uses the READ (possibly slightly stale under a
  // genuine concurrent advance) `oldBoundaryRead` — safe: at worst this
  // fetches a slightly wider range than strictly necessary, never fewer
  // candles than needed, and the client-side merge is dedup-safe either way.
  const fetchFrom = Math.max(periodStart, oldBoundaryRead - 60_000);
  const result = await getHistoricalCandles(canonicalSymbol, fetchFrom, requestedClamped, resolved.provider);
  if (!result.ok) return result;

  // Only NOW, once the fetch has genuinely succeeded, extend the
  // authoritative boundary — atomically and race-safely (see
  // `updateReplayProgress`'s own doc comment for the full rationale: a
  // read-then-write clamp has a proven gap for a concurrent write to land
  // in). `GREATEST(requestedTime, currentValue)` computed against the
  // row's OWN value at write time means a concurrent advance and this one
  // always converge on the correct maximum, regardless of resolution
  // order — never a lost update. `RETURNING` hands back the ACTUAL
  // resulting boundary.
  const rows = await prisma.$queryRaw<{ replayCurrentTime: Date }[]>`
    UPDATE "ReplayReviewSession"
    SET "replayCurrentTime" = LEAST(GREATEST(${new Date(requestedClamped)}::timestamp, COALESCE("replayCurrentTime", ${new Date(periodStart)}::timestamp)), ${new Date(periodEnd)}::timestamp),
        "replayCurrentAsset" = ${canonicalSymbol},
        "replayCurrentTimeframe" = ${timeframe},
        "updatedAt" = NOW()
    WHERE "id" = ${sessionId} AND "userId" = ${userId}
    RETURNING "replayCurrentTime"
  `;
  if (rows.length === 0) {
    return { ok: false, error: { code: "PROVIDER_ERROR", message: "Replay review session not found." } };
  }
  const newBoundary = rows[0].replayCurrentTime.getTime();

  // Only what's NEWLY visible under the extended boundary.
  const newlyVisible = visibleCandles(result.candles, newBoundary, "1m").filter((c) => c.timestamp + 60_000 > oldBoundaryRead);
  // Prompt 6 §20 fix — same reasoning as the read-only path above: advancing
  // THROUGH a pure gap (e.g. a weekend) legitimately moves the boundary
  // forward with zero newly-visible candles; that alone shouldn't "consume"
  // this asset's provenance and lock out MT5 dataset selection before the
  // trader has actually seen anything.
  if (newlyVisible.length > 0) await recordMarketDataProvenance(sessionId, canonicalSymbol, result.provenance);
  return { ok: true, candles: newlyVisible, provenance: result.provenance, currentTime: newBoundary };
}

// ── MT5 explicit Data Source selection (Edge Review Replay Data Source §14-16) ──

/** True once a session's provenance for an asset has actually been used to
 *  serve candles — the freeze-once lifecycle's own definition of "replay
 *  has materially started" for that asset (§16: "before replay begins:
 *  [Change]; after: Locked for this replay"). An entry can exist with zero
 *  segments right after an explicit selection but before the chart has
 *  fetched anything yet — that's still pre-lock. */
function isProvenanceConsumed(entry: StoredMarketDataProvenance | undefined): boolean {
  return (entry?.segments.length ?? 0) > 0;
}

export interface Mt5DataSourceOptionDTO extends MarketDataImportSummaryDTO {
  compatible: boolean;
  /** Empty when `compatible`. Human-readable, e.g. "Different symbol
   *  (EURUSD)" or "Doesn't cover this review period" — never a bare code,
   *  and never hidden: incompatible datasets are still listed (§6). */
  incompatibilityReasons: string[];
}

/**
 * Every one of the user's MT5 imports, annotated with whether it's usable
 * for THIS session's asset/timeframe/review period — compatible ones
 * first, never silently filtered out (§6/§18). Ownership of the session
 * itself is enforced by the `userId` scope on the lookup below; each
 * returned import is already ownership-scoped by `listMt5Imports`.
 */
export async function listMt5DataSourceOptions(
  userId: string,
  sessionId: string,
  canonicalSymbol: string,
  nativeTimeframe: Timeframe,
): Promise<{ ok: true; options: Mt5DataSourceOptionDTO[] } | { ok: false; error: string }> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { startDate: true, endDate: true },
  });
  if (!session) return { ok: false, error: "Review session not found." };

  const periodFromMs = session.startDate.getTime();
  const periodToMs = session.endDate.getTime() + DAY_MS - 1;

  const imports = await listMt5Imports(userId);
  const options: Mt5DataSourceOptionDTO[] = imports.map((imp) => {
    const reasons: string[] = [];
    if (imp.canonicalSymbol !== canonicalSymbol) reasons.push(`Different symbol (${imp.canonicalSymbol})`);
    if (imp.nativeTimeframe !== nativeTimeframe) reasons.push(`Different timeframe (${imp.nativeTimeframe})`);
    const impFromMs = new Date(imp.rangeFrom).getTime();
    // The stored `rangeTo` is the LAST candle's own timestamp (its bar's
    // START, not its end) — a dataset whose last bar starts at 23:59:00
    // still fully covers a day ending at 23:59:59.999, so the comparison
    // extends `rangeTo` by one full native-timeframe interval before
    // checking it against the period's end.
    const impToMs = new Date(imp.rangeTo).getTime() + timeframeToMs(imp.nativeTimeframe) - 1;
    if (impFromMs > periodFromMs || impToMs < periodToMs) reasons.push("Doesn't cover this review period");
    return { ...imp, compatible: reasons.length === 0, incompatibilityReasons: reasons };
  });
  options.sort((a, b) => Number(b.compatible) - Number(a.compatible));

  return { ok: true, options };
}

/**
 * §14/§15 (the user's own top priority for this feature) — explicitly
 * establishes replay provenance for one asset: `providerId: "mt5-imported"`
 * PLUS the exact `MarketDataImport` id, written directly to
 * `marketDataProvenance` before any candle has ever been fetched under it.
 * This is deliberate, trader-driven provenance — never routed through
 * `resolveMarketDataProvider` (which must never choose MT5 automatically,
 * see that function's own doc comment) and never inferred from import
 * presence.
 *
 * Refuses once the asset's provenance is already consumed (§16 — "Locked
 * for this replay"), refuses a dataset that doesn't actually belong to this
 * user (via `getMt5Import`'s ownership scoping, §7/§23), refuses a
 * symbol/timeframe mismatch, and refuses a dataset that doesn't cover the
 * full review period (§19 — never a partial-coverage selection that would
 * later force a silent provider fallback for the missing dates). An
 * UNCONSUMED prior selection (segments still empty) may be freely
 * overwritten — the trader is still allowed to change their mind before
 * replay actually starts pulling candles.
 */
export async function selectMt5DataSource(
  userId: string,
  sessionId: string,
  canonicalSymbol: string,
  importId: string,
  nativeTimeframe: Timeframe,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { marketDataProvenance: true, startDate: true, endDate: true },
  });
  if (!session) return { ok: false, error: "Review session not found." };

  const map = { ...((session.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {}) };
  if (isProvenanceConsumed(map[canonicalSymbol])) {
    return { ok: false, error: "Locked for this replay — candles have already been loaded for this asset." };
  }

  const imp = await getMt5Import(userId, importId);
  if (!imp) return { ok: false, error: "That imported dataset could not be found." };
  if (imp.canonicalSymbol !== canonicalSymbol) {
    return { ok: false, error: `That dataset is for ${imp.canonicalSymbol}, not ${canonicalSymbol}.` };
  }
  if (imp.nativeTimeframe !== nativeTimeframe) {
    return { ok: false, error: `That dataset is ${imp.nativeTimeframe} data, not ${nativeTimeframe}.` };
  }
  const periodFromMs = session.startDate.getTime();
  const periodToMs = session.endDate.getTime() + DAY_MS - 1;
  const impFromMs = new Date(imp.rangeFrom).getTime();
  const impToMs = new Date(imp.rangeTo).getTime() + timeframeToMs(imp.nativeTimeframe) - 1;
  if (impFromMs > periodFromMs || impToMs < periodToMs) {
    return { ok: false, error: "This dataset doesn't cover the full review period." };
  }

  map[canonicalSymbol] = {
    providerId: MT5_IMPORTED_PROVIDER_ID,
    datasetId: imp.id,
    priceBasis: "user-imported",
    retrievedAt: new Date().toISOString(),
    segments: [],
    frozenAt: new Date().toISOString(),
  };
  await prisma.replayReviewSession.update({
    where: { id: sessionId },
    data: { marketDataProvenance: map as unknown as Prisma.InputJsonValue },
  });
  return { ok: true };
}

/**
 * Reverts an UNCONSUMED explicit selection back to automatic resolution
 * (Traditorium Historical Data) — deletes the asset's provenance entry
 * entirely so the next `fetchReplayCandlesWithProvenance` call falls
 * through to `resolveMarketDataProvider` exactly as if no selection had
 * ever been made. Refuses once consumed, same as `selectMt5DataSource`.
 */
export async function resetMarketDataSourceSelection(
  userId: string,
  sessionId: string,
  canonicalSymbol: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { marketDataProvenance: true },
  });
  if (!session) return { ok: false, error: "Review session not found." };

  const map = { ...((session.marketDataProvenance as unknown as MarketDataProvenanceMap | null) ?? {}) };
  const existing = map[canonicalSymbol];
  if (!existing) return { ok: true };
  if (isProvenanceConsumed(existing)) {
    return { ok: false, error: "Locked for this replay — candles have already been loaded for this asset." };
  }

  delete map[canonicalSymbol];
  await prisma.replayReviewSession.update({
    where: { id: sessionId },
    data: { marketDataProvenance: map as unknown as Prisma.InputJsonValue },
  });
  return { ok: true };
}
