/**
 * Frozen Actual-trade comparison evidence (Stage 15.1) — everything the
 * Actual vs Replay Comparison needs to reconstruct what actually happened
 * WITHOUT ever re-querying live Trade state later. Built once when a
 * ReplayReviewSession moves DRAFT -> IN_PROGRESS and stored verbatim inside
 * `ReplayActualBaseline.actualTradeSnapshots` (schemaVersion 2) — the same
 * freeze-once philosophy as `actualBaselineSnapshot` itself and the frozen
 * `setupValidationSnapshot`/`strategyExecutionSnapshot` this module reuses
 * rather than rebuilds (Stage 15.1 §5).
 *
 * REUSE, NOT REINVENTION (§7): win/loss/cancelled classification and
 * realized-R-so-far come from `buildCanonicalTradeRow` (the same function
 * canonical Analytics uses) — this module only adds the richer identity/
 * timing/plan/behaviour fields Comparison needs on top of that, never a
 * second definition of "is this trade executed" or "what's its realized R."
 *
 * IDENTITY VS EVIDENCE (§17): `tradeId` is kept ONLY as an identity
 * reference — for Journal drill-down and for `ReplayComparisonLink` manual
 * pairing. Every comparison FACT below is a value copied out of Trade (or
 * its children) at build time; nothing here is ever re-derived by
 * dereferencing `tradeId` against live data later.
 */
import { buildCanonicalTradeRow, type CanonicalTradeRowInput } from "@/domain/analytics/canonical-dataset";
import { executedAtFromTrade } from "@/domain/trades/lifecycle";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { DirectionLike } from "@/domain/prop-firms/risk";

export interface FrozenBehaviourLabel {
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
}

export interface FrozenPlannedTarget {
  order: number;
  label: string;
  price: number;
  percentToClose: number | null;
  rMultiple: number | null;
}

export interface FrozenActualPartialExit {
  order: number;
  price: number;
  percentClosed: number | null;
  /** ISO — the historical moment this partial actually executed. */
  exitedAt: string;
  realizedR: number | null;
}

export interface ActualTradeComparisonSnapshot {
  // ── Identity (§17 — reference only; never dereferenced for facts) ──────
  tradeId: string;
  dateKey: string;

  // ── Timing (§4) — three distinct, honestly-named instants; no single
  // column is a perfect "decision" timestamp, so all three are frozen
  // rather than picking one and pretending it's exact. ───────────────────
  /** Trade.createdAt — when the idea was first logged. */
  ideaCreatedAt: string;
  /** tradeDate + executionMinutes — the in-market execution instant
   *  (domain/trades/lifecycle.ts's `executedAtFromTrade`), the closest
   *  Actual equivalent to a Replay decision's `historicalTimestamp`. */
  executionStartedAt: string;
  /** Trade.closedAt — when a result was first recorded, null while open. */
  closedAt: string | null;

  assetSymbol: string;
  direction: DirectionLike;
  session: string | null;

  // ── Strategy identity — frozen values only, never live Strategy Lab ────
  strategyId: string | null;
  strategyName: string | null;
  strategyVersion: number | null;
  setupTypeName: string | null;
  scenarioDirection: "BULLISH" | "BEARISH" | null;

  // ── Validation ───────────────────────────────────────────────────────
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  /** The frozen Stage 4 record verbatim — reused, never rebuilt. */
  validationSnapshot: SetupValidationSnapshot | null;
  overrideReason: string | null;
  overrideNote: string | null;

  // ── Plan — prefers the last CONFIRMED TradePlanVersion (immutable once
  // created) over the live/legacy Trade.plannedEntry/StopLoss/Target trio,
  // since a plan version can never change after the fact (§5). ──────────
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTargets: FrozenPlannedTarget[];
  /** Trade.expectedRR — the confirmed plan's weighted planned R. */
  plannedR: number | null;

  // ── Execution ────────────────────────────────────────────────────────
  actualEntry: number | null;
  actualStopLoss: number | null;
  /** The Performance Account's own frozen 1R-defining stop, when resolved —
   *  preferred over actualStopLoss for the same reason canonical Analytics
   *  prefers it (never redefined once locked). */
  resolvedInitialStop: number | null;
  partialExits: FrozenActualPartialExit[];
  actualExit: number | null;
  /** Partial-aware realized-so-far R — same definition as canonical
   *  Analytics's `realizedR` (via `buildCanonicalTradeRow`). */
  realizedR: number | null;
  /** Only set once FULLY_CLOSED — same definition as canonical Analytics's
   *  `finalizedR`. */
  finalizedR: number | null;
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  isCancelled: boolean;
  winLossClass: "WIN" | "LOSS" | "BREAKEVEN" | "PENDING" | "CANCELLED";

  // ── Behaviour — Actual-only context (§18); Replay has no equivalent ────
  behaviourLabels: FrozenBehaviourLabel[];
  preTradeMoodTags: string[];
  preTradeMoodIntensity: number | null;
  /** FOMO/REVENGE/BOREDOM/IMPULSE/MANUAL_OVERRIDE/PLANNED/null — the
   *  Counterfactual engine's behavioral-intent tag; Actual-only context,
   *  never fabricated for a Replay decision. */
  tradeIntent: string | null;

  // ── Context ──────────────────────────────────────────────────────────
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
}

export interface ActualTradeComparisonSnapshotInput {
  tradeId: string;
  dateKey: string;
  createdAt: Date;
  tradeDate: Date;
  executionMinutes: number;
  closedAt: Date | null;
  direction: DirectionLike;
  assetSymbol: string;
  session: string | null;
  strategyId: string | null;
  strategyName: string | null;
  strategyVersion: number | null;
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  overrideReason: string | null;
  overrideNote: string | null;
  setupValidationSnapshot: SetupValidationSnapshot | null;
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  plannedR: number | null;
  actualRR: number | null;
  actualEntry: number | null;
  actualStopLoss: number | null;
  actualExit: number | null;
  resolvedInitialStop: number | null;
  /** Live/legacy plan fields — used only when no confirmed plan version exists. */
  legacyPlannedEntry: number | null;
  legacyPlannedStopLoss: number | null;
  legacyPlannedTarget: number | null;
  /** The last CONFIRMED TradePlanVersion, if any (§5) — immutable once created. */
  confirmedPlan: {
    entry: number | null;
    stopLoss: number | null;
    weightedPlannedR: number | null;
    /** TradePlanVersion.targetsSnapshot — [{targetOrder,label,targetPrice,rMultiple,plannedClosePercent}]. */
    targetsSnapshot: unknown;
  } | null;
  actualPartialExits: {
    exitOrder: number;
    exitPrice: number;
    percentClosed: number | null;
    exitedAt: Date;
    realizedR: number | null;
  }[];
  settled: boolean;
  settledRealizedR: number | null;
  settledPnl: number | null;
  preTradeMoodTags: string[];
  preTradeMoodIntensity: number | null;
  tradeIntent: string | null;
  behaviourLabels: FrozenBehaviourLabel[];
}

function parseTargetsSnapshot(raw: unknown): FrozenPlannedTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t): FrozenPlannedTarget | null => {
      if (typeof t !== "object" || t == null) return null;
      const row = t as Record<string, unknown>;
      const price = typeof row.targetPrice === "number" ? row.targetPrice : Number(row.targetPrice);
      if (!Number.isFinite(price)) return null;
      return {
        order: typeof row.targetOrder === "number" ? row.targetOrder : 0,
        label: typeof row.label === "string" ? row.label : `TP${row.targetOrder ?? ""}`,
        price,
        percentToClose: row.plannedClosePercent == null ? null : Number(row.plannedClosePercent),
        rMultiple: row.rMultiple == null ? null : Number(row.rMultiple),
      };
    })
    .filter((t): t is FrozenPlannedTarget => t != null)
    .sort((a, b) => a.order - b.order);
}

export function buildActualTradeComparisonSnapshot(input: ActualTradeComparisonSnapshotInput): ActualTradeComparisonSnapshot {
  const setupSnapshot = input.setupValidationSnapshot;

  // Reuse the canonical row builder for isExecuted/isCancelled/winLossClass/
  // realizedR/finalizedR — the ONE definition of "what happened" (§7).
  const canonicalInput: CanonicalTradeRowInput = {
    tradeId: input.tradeId,
    dateKey: input.dateKey,
    direction: input.direction,
    assetSymbol: input.assetSymbol,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    session: input.session,
    reviewLifecycleStatus: input.reviewLifecycleStatus,
    validationState: input.validationState,
    overrideReason: input.overrideReason,
    setupTypeName: setupSnapshot?.setupType.name ?? null,
    validationScore: setupSnapshot?.score ?? null,
    dailyBiasSnapshot: input.dailyBiasSnapshot,
    plannedR: input.plannedR,
    actualRR: input.actualRR,
    actualEntry: input.actualEntry,
    actualStopLoss: input.actualStopLoss,
    actualExit: input.actualExit,
    resolvedInitialStop: input.resolvedInitialStop,
    partials: input.actualPartialExits.map((p) => ({ exitPrice: p.exitPrice, percentClosed: p.percentClosed })),
    settled: input.settled,
    settledRealizedR: input.settledRealizedR,
    settledPnl: input.settledPnl,
    preTradeMoodTags: input.preTradeMoodTags,
    moodIntensity: input.preTradeMoodIntensity,
    behaviourLabels: input.behaviourLabels,
    adherencePercent: null,
    confluencePercent: null,
    executionPercent: null,
    tradeQualityPercent: null,
    psychologyPercent: null,
  };
  const canonicalRow = buildCanonicalTradeRow(canonicalInput);

  const plannedTargets = input.confirmedPlan
    ? parseTargetsSnapshot(input.confirmedPlan.targetsSnapshot)
    : input.legacyPlannedTarget != null
      ? [{ order: 1, label: "Target", price: input.legacyPlannedTarget, percentToClose: null, rMultiple: null }]
      : [];

  return {
    tradeId: input.tradeId,
    dateKey: input.dateKey,
    ideaCreatedAt: input.createdAt.toISOString(),
    executionStartedAt: executedAtFromTrade(input.tradeDate, input.executionMinutes).toISOString(),
    closedAt: input.closedAt?.toISOString() ?? null,
    assetSymbol: input.assetSymbol,
    direction: input.direction,
    session: input.session,
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    strategyVersion: input.strategyVersion,
    setupTypeName: setupSnapshot?.setupType.name ?? null,
    scenarioDirection: setupSnapshot?.scenario.direction ?? null,
    validationState: input.validationState,
    validationSnapshot: setupSnapshot,
    overrideReason: input.overrideReason,
    overrideNote: input.overrideNote,
    plannedEntry: input.confirmedPlan?.entry ?? input.legacyPlannedEntry,
    plannedStopLoss: input.confirmedPlan?.stopLoss ?? input.legacyPlannedStopLoss,
    plannedTargets,
    plannedR: input.plannedR,
    actualEntry: input.actualEntry,
    actualStopLoss: input.actualStopLoss,
    resolvedInitialStop: input.resolvedInitialStop,
    partialExits: input.actualPartialExits
      .slice()
      .sort((a, b) => a.exitOrder - b.exitOrder)
      .map((p) => ({ order: p.exitOrder, price: p.exitPrice, percentClosed: p.percentClosed, exitedAt: p.exitedAt.toISOString(), realizedR: p.realizedR })),
    actualExit: input.actualExit,
    realizedR: canonicalRow.realizedR,
    finalizedR: canonicalRow.finalizedR,
    reviewLifecycleStatus: input.reviewLifecycleStatus,
    isCancelled: canonicalRow.isCancelled,
    winLossClass: canonicalRow.winLossClass,
    behaviourLabels: input.behaviourLabels,
    preTradeMoodTags: input.preTradeMoodTags,
    preTradeMoodIntensity: input.preTradeMoodIntensity,
    tradeIntent: input.tradeIntent,
    dailyBiasSnapshot: input.dailyBiasSnapshot,
  };
}
