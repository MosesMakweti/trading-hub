/**
 * Actual vs Replay Comparison (Stage 15, enriched Stage 15.1, completed
 * Stage 15.2) — pure DTOs. Nothing here touches Prisma or React; the
 * service layer (server/services/replay-comparison.service.ts) builds
 * these from the frozen `ReplayActualBaseline`, the session's
 * `ReplayTradeDTO[]`, and any persisted `ReplayComparisonLink` rows, and
 * the UI only ever renders what's already computed here.
 *
 * See decision-matching.ts's own doc comment for the matching algorithm
 * (legacy array-order fallback vs Stage 15.1's evidence-scored matching),
 * and actual-trade-comparison-snapshot.ts for exactly what Actual-side
 * evidence is (and isn't) frozen.
 *
 * TERMINOLOGY (Stage 15.2 §30) — used consistently everywhere in this
 * module and its UI: Actual, Replay, Outcome Difference/Gap, Decision
 * Difference, Validation Difference, Execution Difference, Strategy
 * Variance, Execution Discrepancy, Behavioral Discrepancy, Opportunity
 * Discrepancy, Potential Missed Opportunity, Confirmed Missed Opportunity.
 * Never: mistake, lost profit, wrong trade, should have, cost of error.
 */
import type { ActualTradeComparisonSnapshot, ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

// ── Matching (Stage 15.1, extended Stage 15.2) ──────────────────────────────

/**
 * Matching confidence — comes from evidence, never from array position.
 * HIGH and MEDIUM are both genuine matches (MEDIUM means "review needed,"
 * not "probably wrong"); a candidate that doesn't clear the minimum score
 * is left UNMATCHED rather than force-paired (false matches are worse than
 * unmatched rows).
 */
export type MatchConfidence = "HIGH" | "MEDIUM";

/** Internal match reasons — not shown to the trader verbatim; the UI
 *  translates these into plain copy. */
export type MatchReason = "EXACT_CONTEXT_MATCH" | "TIME_PROXIMITY_MATCH" | "LEGACY_BASELINE_FALLBACK" | "MANUAL_LINK";

/** Whether this specific pairing came from the deterministic algorithm or a
 *  trader's explicit correction (Stage 15.2 §2) — shown as a subtle badge,
 *  never the scoring internals. */
export type MatchSource = "AUTO" | "MANUAL";

/** A trader-confirmed correction (persisted as `ReplayComparisonLink`).
 *  `MATCHED` forces a pairing the algorithm missed or got wrong; `EXCLUDED`
 *  suppresses a specific pairing the algorithm would otherwise make. */
export interface ManualComparisonLink {
  actualTradeId: string;
  replayTradeId: string;
  linkType: "MATCHED" | "EXCLUDED";
}

/** A trader's confirm/reject decision on a Potential Missed Opportunity
 *  (Stage 15.2 §5-6) — persisted as an `OPPORTUNITY`-type
 *  `ReplayComparisonLink` keyed by `replayTradeId` alone (no Actual trade
 *  exists to pair with). */
export interface OpportunityConfirmation {
  replayTradeId: string;
  classification: "CONFIRMED_MISSED" | "NOT_MISSED";
}

// ── Decision classification (Stage 15.2 §3) ─────────────────────────────────

/**
 * The factual relationship between an Actual trade and a Replay decision —
 * never a blame judgment (§3). `SAME_DECISION` and
 * `ACTUAL_TAKEN_REPLAY_SKIPPED` apply to matched pairs; the rest apply to
 * unmatched entries.
 */
export type OpportunityClassification =
  | "SAME_DECISION"
  | "ACTUAL_TAKEN_REPLAY_SKIPPED"
  | "ACTUAL_ABSENT_REPLAY_TAKEN"
  | "UNMATCHED_ACTUAL"
  | "UNMATCHED_REPLAY"
  | "EXCLUDED_DIFFERENT_OPPORTUNITY";

/** A Replay TAKEN decision with no matching Actual trade starts
 *  `UNCONFIRMED` ("Potential Missed Opportunity") and is never counted in
 *  Opportunity Discrepancy until the trader explicitly confirms it (§5). */
export type MissedOpportunityStatus = "UNCONFIRMED" | "CONFIRMED_MISSED" | "NOT_MISSED";

// ── Period metrics (Stage 15 §4-5) ──────────────────────────────────────────

/** The shared metric shape both the Actual and Replay period tables render
 *  — same field set, computed independently on each side so neither can
 *  silently borrow the other's definition. */
export interface PeriodMetrics {
  executedTrades: number;
  /** Trades with a determined final result — the sample size backing
   *  winRate/averageR/expectancy/profitFactor. */
  finalizedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  totalRealizedR: number;
  averageRPerTrade: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  validatedTrades: number;
  overrideCount: number;
}

export interface ReplayDecisionTypeCounts {
  taken: number;
  skipped: number;
}

export interface ReplayGroupStats extends PeriodMetrics {
  key: string;
  label: string;
}

export interface ReplayPeriodSummary {
  metrics: PeriodMetrics;
  decisionCounts: ReplayDecisionTypeCounts;
  bySetupType: ReplayGroupStats[];
  byStrategy: ReplayGroupStats[];
  byDirection: ReplayGroupStats[];
  byAsset: ReplayGroupStats[];
  byValidationState: ReplayGroupStats[];
}

export interface ActualPeriodSummary {
  metrics: PeriodMetrics;
}

// ── Cumulative R (Stage 15.2 §8) ────────────────────────────────────────────

export interface CumulativeRPoint {
  dateKey: string;
  id: string;
  r: number;
  cumulativeR: number;
}

/** "Actual vs Replay — Cumulative R" — both series start at 0; the space
 *  between them (if shaded in the UI) is the "Outcome Gap," never
 *  "discrepancy" (§8). */
export interface CumulativeRComparison {
  actual: CumulativeRPoint[];
  replay: CumulativeRPoint[];
}

// ── Per-pair difference categories (Stage 15 §2, extended Stage 15.2) ──────

/** §2.A — what happened numerically. Deliberately just the two numbers and
 *  their delta, with NO judgment attached (a negative delta does not mean
 *  the Actual trade was "wrong"). Called "Outcome Difference"/"Outcome Gap"
 *  in the UI — never "mistake cost." */
export interface OutcomeDifference {
  actualR: number | null;
  replayR: number | null;
  deltaR: number | null;
}

/** §2.B / §9 — did the trader arrive at a different decision for the same
 *  asset/day: direction, strategy, Setup Type, validation outcome, original
 *  daily bias, or Replay's TAKEN/SKIPPED choice itself. */
export interface DecisionDifference {
  actualDirection: "LONG" | "SHORT";
  replayDirection: "LONG" | "SHORT" | null;
  sameDirection: boolean;
  actualStrategyName: string | null;
  replayStrategyName: string | null;
  sameStrategy: boolean;
  actualSetupTypeName: string | null;
  replaySetupTypeName: string | null;
  sameSetupType: boolean;
  actualValidationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  replayValidationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  sameValidationState: boolean;
  /** From the frozen Actual snapshot only — null for a legacy pairing or a
   *  trade with no Daily Market Plan analysis that day. Reference context,
   *  never a rule (matches Replay's own "Original Market Plan" framing). */
  actualDailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
  replayDecisionType: ReplayTradeDTO["decisionType"];
}

/** §10 — condition-level Setup Type validation comparison. Only meaningful
 *  when both sides validated against a compatible historical Strategy
 *  version/Setup Type/scenario; otherwise `comparable` is false and no
 *  condition-by-condition claim is made (§10's explicit fallback). */
export interface ValidationConditionComparison {
  checklistItemId: string;
  name: string;
  mandatory: boolean;
  checkedInActual: boolean;
  checkedInReplay: boolean;
}

export interface ValidationDifference {
  comparable: boolean;
  /** Set only when `comparable` is false — e.g. "Different historical
   *  Strategy versions — condition-by-condition comparison unavailable." */
  incompatibilityReason: string | null;
  actualValidationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  replayValidationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  actualScore: number | null;
  replayScore: number | null;
  actualOverrideReason: string | null;
  replayOverrideReason: string | null;
  conditions: ValidationConditionComparison[];
  checkedOnlyInActual: string[];
  checkedOnlyInReplay: string[];
  mandatoryDifferenceNames: string[];
}

/** §11-13 — a normalized (never raw-price-only) execution comparison. Falls
 *  back to raw price with `unit: "PRICE"` when the instrument can't be
 *  resolved from the catalog. `signedDifference` is Replay minus Actual in
 *  price terms — a neutral magnitude, not a "better/worse" verdict (the UI
 *  phrases it factually, e.g. "Replay entered 0.22R earlier"). */
export interface NormalizedPriceDifference {
  actual: number | null;
  replay: number | null;
  signedDifference: number | null;
  rDistance: number | null;
  unitDistance: number | null;
  unit: "PIP" | "TICK" | "POINT" | "PRICE" | "PERCENT" | null;
}

export interface FrozenExitEvent {
  order: number;
  price: number;
  percentClosed: number | null;
  timestamp: string | null;
  realizedR: number | null;
}

export interface ExecutionDifference {
  actualReviewLifecycle: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  replayLifecycle: ReplayTradeDTO["lifecycle"];
  actualHadPartials: boolean;
  replayHadPartials: boolean;
  samePartialManagementShape: boolean;
  /** True only when both sides have real entry/stop evidence to compare —
   *  a legacy-matched pair (no `actualSnapshot`) has neither. */
  comparable: boolean;
  entry: NormalizedPriceDifference;
  initialStop: NormalizedPriceDifference;
  actualPartialExits: FrozenExitEvent[];
  replayPartialExits: FrozenExitEvent[];
  actualFullExit: number | null;
  replayFullExit: number | null;
  actualRealizedR: number | null;
  replayRealizedR: number | null;
}

/** §14 — split into what's genuinely comparable from evidence both sides
 *  capture, and Actual-only context that Replay simply has no equivalent
 *  for (never fabricated onto Replay). */
export interface BehaviourPairDifference {
  actualOverridden: boolean;
  replayOverridden: boolean;
  actualTookReplaySkipped: boolean;
  actualStopMovedOrWidened: boolean | null; // null = not determinable (no frozen initial-vs-final stop evidence)
  replayStopMoved: boolean;
  actualManualOrEarlyExit: boolean | null; // null = not determinable
  replayFollowedPlannedTargets: boolean;
  /** Actual-only context (§14) — shown as explanatory evidence, never
   *  translated into a fabricated Replay equivalent. */
  actualBehaviourLabels: { name: string; polarity: "POSITIVE" | "NEGATIVE" }[];
  actualMoodTags: string[];
  actualMoodIntensity: number | null;
  actualTradeIntent: string | null;
}

export interface MatchedDecisionPair {
  dateKey: string;
  assetSymbol: string;
  actual: ActualTradeRefDTO;
  replay: ReplayTradeDTO;
  outcome: OutcomeDifference;
  decision: DecisionDifference;
  validation: ValidationDifference;
  execution: ExecutionDifference;
  behaviour: BehaviourPairDifference;
  classification: "SAME_DECISION" | "ACTUAL_TAKEN_REPLAY_SKIPPED";
  confidence: MatchConfidence;
  reason: MatchReason;
  source: MatchSource;
  /** The richer frozen evidence, when the baseline that produced this pair
   *  was enriched (`schemaVersion: 2`) — null for a legacy (v1) baseline's
   *  fallback pairing. */
  actualSnapshot: ActualTradeComparisonSnapshot | null;
}

export interface UnmatchedActualEntry {
  dateKey: string;
  assetSymbol: string;
  actual: ActualTradeRefDTO;
  actualSnapshot: ActualTradeComparisonSnapshot | null;
  classification: "UNMATCHED_ACTUAL" | "EXCLUDED_DIFFERENT_OPPORTUNITY";
}

export interface UnmatchedReplayEntry {
  dateKey: string;
  assetSymbol: string;
  replay: ReplayTradeDTO;
  classification: "ACTUAL_ABSENT_REPLAY_TAKEN" | "UNMATCHED_REPLAY" | "EXCLUDED_DIFFERENT_OPPORTUNITY";
  /** Only meaningful for a TAKEN decision (`ACTUAL_ABSENT_REPLAY_TAKEN`) —
   *  a SKIPPED one is never a missed opportunity (§4). */
  missedOpportunityStatus: MissedOpportunityStatus | null;
  confirmedAt: string | null;
}

export interface OpportunityDifferenceSummary {
  /** Actual trades with no matching Replay decision this period. */
  unmatchedActual: UnmatchedActualEntry[];
  /** Replay TAKEN decisions with no matching real Trade — each a
   *  "Potential Missed Opportunity" until confirmed/rejected (§5). */
  unmatchedReplayTaken: UnmatchedReplayEntry[];
  /** Replay SKIPPED decisions with no matching real Trade — recorded
   *  restraint, never an opportunity difference. */
  unmatchedReplaySkipped: UnmatchedReplayEntry[];
}

/** Period-level validation-discipline PATTERNS both sides actually have
 *  data for — see this module's Stage 15.1 audit for why a genuine
 *  per-trade behaviour-label comparison isn't possible with what Replay
 *  captures. */
export interface BehaviourComparisonSummary {
  actualOverrideRate: number | null;
  replayOverrideRate: number | null;
  actualValidatedRate: number | null;
  replayValidatedRate: number | null;
  replaySkipRate: number | null;
}

// ── Four-bucket discrepancy summary (Stage 15.2 §15-20) ─────────────────────

export interface StrategyVarianceEntry {
  dateKey: string;
  assetSymbol: string;
  actualR: number | null;
  replayR: number | null;
  note: string;
}

/** §15 — a valid setup losing normally (or the same process producing a
 *  different result on both sides) is NOT a discrepancy. Represented
 *  count-wise, never as a fabricated R-cost. */
export interface StrategyVarianceSummary {
  count: number;
  entries: StrategyVarianceEntry[];
}

export type ExecutionDiscrepancyCategory =
  | "ENTRY_DEGRADATION"
  | "STOP_WIDENING"
  | "PREMATURE_CLOSE"
  | "PARTIAL_NOT_FOLLOWED";

export interface ExecutionDiscrepancyEvent {
  dateKey: string;
  assetSymbol: string;
  category: ExecutionDiscrepancyCategory;
  /** A defensible R-cost when computable from frozen entry/stop/exit
   *  evidence on both sides; null when the category is evidenced but no
   *  defensible number exists (§16 — never invent one). */
  costR: number | null;
  description: string;
}

/** §16 — only trader-controlled execution differences the system can
 *  defensibly identify, computed the SAME way as the existing
 *  plan-execution-comparison engine (Actual's own real execution treated as
 *  the reference, Replay's simulated execution as the comparison side). */
export interface ExecutionDiscrepancySummary {
  count: number;
  /** Sum of only the entries that HAVE a `costR` — never padded with
   *  entries that only have a category/count. */
  totalCostR: number;
  events: ExecutionDiscrepancyEvent[];
}

export type BehavioralDiscrepancyCategory = "OVERRIDE_VS_SKIP" | "INVALID_SETUP_TAKEN" | "BEHAVIOUR_LABEL_EVIDENCE";

export interface BehavioralDiscrepancyEvent {
  dateKey: string;
  assetSymbol: string;
  category: BehavioralDiscrepancyCategory;
  description: string;
}

/** §17 — process/rule divergence, not outcome. Deliberately a count, never
 *  converted into an R number. */
export interface BehavioralDiscrepancySummary {
  count: number;
  events: BehavioralDiscrepancyEvent[];
}

export interface ConfirmedMissedOpportunityEntry {
  replayTradeId: string;
  dateKey: string;
  assetSymbol: string;
  strategyName: string | null;
  setupTypeName: string | null;
  replayValidationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  /** The Replay outcome OF the missed opportunity — not automatically
   *  "avoidable R" (§18). */
  replayRealizedR: number | null;
  confirmedAt: string | null;
}

/** §18 — ONLY confirmed missed opportunities, never every unmatched Replay
 *  TAKEN decision. */
export interface OpportunityDiscrepancySummary {
  count: number;
  totalReplayR: number;
  entries: ConfirmedMissedOpportunityEntry[];
}

/** §20 — an aggregate that exists ONLY over components with a defensible
 *  trader-controlled R-cost. Never includes a valid loss, the raw
 *  Actual-vs-Replay outcome gap, Strategy Variance, or an unconfirmed
 *  missed opportunity. See `AVOIDABLE_DISCREPANCY_FORMULA` for the exact,
 *  documented definition. */
export interface AvoidableDiscrepancySummary {
  totalR: number;
  formula: string;
}

export interface DiscrepancyBuckets {
  strategyVariance: StrategyVarianceSummary;
  executionDiscrepancy: ExecutionDiscrepancySummary;
  behavioralDiscrepancy: BehavioralDiscrepancySummary;
  opportunityDiscrepancy: OpportunityDiscrepancySummary;
  avoidableDiscrepancy: AvoidableDiscrepancySummary;
}

// ── Override analysis (Stage 15.2 §21) ──────────────────────────────────────

export interface OverrideAnalysis {
  actual: { validated: number; overridden: number; notValidated: number };
  replay: { validated: number; overridden: number; skipped: number };
  /** Review cases — never automatic mistakes (§21). */
  actualOverrideReplaySkipped: number;
  actualOverrideReplayValidated: number;
  actualValidatedReplaySkipped: number;
}

// ── Category breakdowns (Stage 15.2 §22) ────────────────────────────────────

export interface CategoryComparisonRow {
  key: string;
  label: string;
  actualR: number;
  actualCount: number;
  replayR: number;
  replayTakenCount: number;
}

export interface ComparisonBreakdowns {
  byAsset: CategoryComparisonRow[];
  byStrategy: CategoryComparisonRow[];
  bySetupType: CategoryComparisonRow[];
  byDirection: CategoryComparisonRow[];
}

// ── Top level ────────────────────────────────────────────────────────────—

export interface ActualVsReplayComparison {
  /** §25 — the review's own status, so the UI can show "Provisional
   *  Comparison — Replay incomplete" for anything short of COMPLETED. */
  sessionStatus: "DRAFT" | "IN_PROGRESS" | "COMPLETED";
  isProvisional: boolean;
  actual: ActualPeriodSummary;
  replay: ReplayPeriodSummary;
  cumulativeR: CumulativeRComparison;
  matched: MatchedDecisionPair[];
  opportunity: OpportunityDifferenceSummary;
  behaviour: BehaviourComparisonSummary;
  discrepancy: DiscrepancyBuckets;
  overrideAnalysis: OverrideAnalysis;
  breakdowns: ComparisonBreakdowns;
}
