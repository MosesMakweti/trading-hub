import type { ReplayReviewType, ReplayReviewStatus, ReplayDecisionType } from "@prisma/client";

import type { CanonicalAnalyticsSummary } from "@/server/services/analytics-canonical.service";
import type { OpportunitySummary } from "@/domain/analytics/opportunity-engine";
import type { PsychologyAdherenceSummary } from "@/domain/analytics/canonical-aggregations";
import type { StrategyVersionSnapshot } from "@/types/strategies";
import type { ActualTradeComparisonSnapshot } from "@/domain/replay/actual-trade-comparison-snapshot";
import type { CandleProvenance } from "@/domain/market-data/provider-types";

export type { ReplayReviewType, ReplayReviewStatus, ReplayDecisionType };
export type { ActualTradeComparisonSnapshot };

/**
 * Stage 17B §13 — one asset's FROZEN market-data provenance for a session:
 * `CandleProvenance` plus WHEN it was first frozen. Never mutated once the
 * `providerId` is set (see replay-review.service.ts's
 * `fetchReplayCandlesWithProvenance`) — `segments`/`retrievedAt` may still
 * grow as the trader replays into newly-fetched days, but the provider
 * itself never silently changes mid-session.
 */
export interface StoredMarketDataProvenance extends CandleProvenance {
  frozenAt: string;
}

/** Keyed by canonical asset symbol. A session created before Stage 17B has
 *  this as `null`/absent for every asset — render "Legacy / source not
 *  recorded" rather than guessing (§16). */
export type MarketDataProvenanceMap = Record<string, StoredMarketDataProvenance>;

/** A compact, read-only reference into one real historical Trade — Stage 12
 *  §15. Deliberately NOT the full Trade Workspace shape; drill-down reuses
 *  the existing Journal trade page rather than a second renderer. Sourced
 *  directly from the canonical dataset row, never a separate query. */
export interface ActualTradeRefDTO {
  tradeId: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  strategyName: string | null;
  setupTypeName: string | null;
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  isCancelled: boolean;
  winLossClass: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | "CANCELLED";
  realizedR: number | null;
  finalizedR: number | null;
  pnl: number | null;
}

/**
 * The frozen "WHAT ACTUALLY HAPPENED" record (Stage 12 §6-7) — computed once
 * when a session moves DRAFT → IN_PROGRESS and stored verbatim in
 * `ReplayReviewSession.actualBaselineSnapshot`. Built entirely from the SAME
 * canonical (R-primary) dataset and aggregators normal trader Analytics uses
 * (`canonical`) plus the existing Opportunity engine (`opportunity`) — no
 * second performance engine, no contribution-% math.
 */
export interface ReplayActualBaseline {
  computedAt: string; // ISO
  range: { startDate: string; endDate: string };
  scope: { strategyId: string | null; strategyName: string | null; assetSymbols: string[] };
  canonical: CanonicalAnalyticsSummary;
  /** Plain mean realized R across every FULLY_CLOSED trade (Edge Review's
   *  "Avg / Trade") — distinct from `canonical.overview.expectancy`, which
   *  excludes breakevens from its win/loss split. Kept here rather than on
   *  the shared `CanonicalAnalyticsSummary.overview` since Analytics itself
   *  has no use for it. */
  averageRealizedR: number | null;
  /** Edge Review's psychology/rule-adherence averages (Stage 12.5 §6) — see
   *  domain/analytics/canonical-aggregations.ts's own doc comment for why
   *  this lives here and not on the shared canonical summary. */
  psychologyAdherence: PsychologyAdherenceSummary;
  /** Date-range-scoped only — the existing opportunity engine has no
   *  strategy/asset-scoped query yet, so a narrowed session's opportunity
   *  numbers cover the whole period, not just the scoped subset. */
  opportunity: { hasData: boolean; summary: OpportunitySummary };
  actualTrades: ActualTradeRefDTO[];
  /**
   * Stage 15.1 — baseline schema version. Absent (`undefined`) on every
   * baseline frozen before this stage ("v1": `actualTrades` only, no
   * `actualTradeSnapshots`). `2` means `actualTradeSnapshots` below was
   * populated at freeze time. NEVER backfilled onto an old baseline — a
   * historical snapshot stays exactly as frozen; callers must branch on
   * this field rather than assume the richer data exists (see
   * domain/replay-comparison/decision-matching.ts's legacy fallback).
   */
  schemaVersion?: 2;
  /**
   * Stage 15.1 — richer frozen Actual-trade evidence for Comparison, absent
   * on v1 baselines. See `ActualTradeComparisonSnapshot`'s own doc comment
   * for exactly what's frozen and why; `actualTrades` above is kept
   * unchanged alongside this (still used by the Actual Period reference
   * panel) rather than replaced, since removing it would be a breaking
   * change to every already-frozen v1 baseline.
   */
  actualTradeSnapshots?: ActualTradeComparisonSnapshot[];
}

export interface ReplayReviewSessionDTO {
  id: string;
  reviewType: ReplayReviewType;
  startDate: string;
  endDate: string;
  status: ReplayReviewStatus;
  strategyId: string | null;
  strategyName: string | null;
  assetSymbols: string[];
  notes: unknown;
  actualBaselineSnapshot: ReplayActualBaseline | null;
  /** Replay Clock checkpoint (Stage 13 §10) — null until the trader has
   *  paused/switched/left the Replay tab at least once. */
  replayResumePoint: { currentTime: number; asset: string; timeframe: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Stage 16 — set only by `finalizeEdgeReview` ("Finish Review" in
   *  Improvements); distinct from `completedAt`/`status: COMPLETED`, which
   *  is Replay's own completion. See the schema's own doc comment. */
  reviewFinalizedAt: string | null;
  /** Stage 17B §13/§16 — null on every session frozen before this stage
   *  ("Legacy / source not recorded"), otherwise one frozen provenance
   *  record per canonical asset this session has ever fetched candles for. */
  marketDataProvenance: MarketDataProvenanceMap | null;
}

/** The Replay landing page's compact row — Stage 12 §2. */
export interface ReplaySessionListItemDTO {
  id: string;
  reviewType: ReplayReviewType;
  startDate: string;
  endDate: string;
  status: ReplayReviewStatus;
  strategyName: string | null;
  assetSymbols: string[];
  totalRealizedR: number | null;
  winRate: number | null;
  executedTrades: number | null;
}

/** Historical Strategy context (Stage 12 §8) — read from the immutable
 *  `StrategyVersion.snapshot` the Trade was actually saved under, never
 *  today's live Strategy Lab config. Null fields mean the version predates
 *  publish/versioning and no snapshot exists — never backfilled from live
 *  config, since that would misrepresent history. */
export interface HistoricalStrategyContextDTO {
  strategyId: string;
  strategyName: string;
  version: number;
  createdAt: string;
  note: string | null;
  snapshot: StrategyVersionSnapshot;
}

export interface ReplayPlannedTargetDTO {
  id: string;
  order: number;
  price: number;
  percentToClose: number;
  filledAt: string | null;
}

export interface ReplayTradePartialExitDTO {
  id: string;
  plannedTargetId: string | null;
  source: "TARGET_HIT" | "MANUAL";
  exitPrice: number;
  percentClosed: number | null;
  realizedR: number | null;
  executedAt: string | null;
}

export interface ReplayExecutionEventDTO {
  id: string;
  eventType:
    | "ORDER_PLACED"
    | "ORDER_FILLED"
    | "SL_MOVED"
    | "PARTIAL_CLOSE"
    | "FULL_CLOSE"
    | "ORDER_CANCELLED"
    | "AMBIGUOUS_CANDLE"
    | "AMBIGUITY_RESOLVED";
  historicalTimestamp: string;
  data: unknown;
}

/** A SIMULATED decision point — Stage 12 §11, execution added Stage 14. Never
 *  a real Trade; see ReplayTrade's schema doc comment for the actual/replay
 *  boundary. */
export interface ReplayTradeDTO {
  id: string;
  historicalTimestamp: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT" | null;
  strategyId: string | null;
  strategyNameSnapshot: string | null;
  strategyVersionSnapshot: number | null;
  setupTypeNameSnapshot: string | null;
  decisionType: ReplayDecisionType;

  replayValidationSnapshot: unknown; // SetupValidationSnapshot shape, or null
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  overrideReason: string | null;
  overrideNote: string | null;

  lifecycle: "PLANNED" | "PENDING" | "OPEN" | "PARTIALLY_CLOSED" | "CLOSED" | "CANCELLED";
  orderType: "MARKET" | "PENDING";
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  currentStopLoss: number | null;
  simulatedEntry: number | null;
  filledAt: string | null;
  simulatedExit: number | null;
  closedAt: string | null;
  closeReason: "STOP_LOSS" | "TARGET" | "MANUAL" | null;
  remainingPercent: number;
  realizedReplayR: number;
  lastProcessedTime: string | null;
  pendingAmbiguity: unknown;

  notes: unknown;
  targets: ReplayPlannedTargetDTO[];
  partialExits: ReplayTradePartialExitDTO[];
  executionEvents: ReplayExecutionEventDTO[];
}
