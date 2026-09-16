/**
 * Traditorium AI Review Analyst (Stage 20) — provider-independent types.
 *
 * Core principle: "Traditorium AI analyzes the trader, not the market."
 * Everything here describes structured evidence ABOUT the trader's process
 * (planning, execution, behavior, psychology, Replay, discrepancy,
 * commitments, longitudinal improvement) and a validated, cited
 * interpretation of it. Nothing here — and nothing the analyst is asked to
 * produce — predicts market direction, generates trade signals, or acts
 * autonomously. AI interpretation sits ABOVE the deterministic systems
 * (Stage 1-19.1); it never replaces or mutates them.
 */

// ── Evidence hierarchy (§8) ─────────────────────────────────────────────────

/**
 * OBJECTIVE: a system-computed fact with no trader self-report involved
 * (e.g. "4 invalid overrides", "stop widened on 3 trades").
 * DERIVED: a deterministic INTERPRETATION Traditorium already computed from
 * objective facts (e.g. an Execution Discrepancy classification, a
 * commitment trend of DECLINING) — still fully deterministic, just one
 * layer removed from the raw fact.
 * TRADER_REPORTED: the trader's own entered reflection/psychology/behavior
 * state (e.g. a FOMO label, "I felt impatient," a weekly reflection).
 * The analyst must never blur these three — each evidence item is tagged
 * with exactly one.
 */
export type EvidenceStrength = "OBJECTIVE" | "DERIVED" | "TRADER_REPORTED";

/**
 * A single evidence item the analyst may cite by `id`. `id` follows a
 * stable `CATEGORY:discriminator` scheme (§7) — see
 * `evidence-package.ts`'s id-building helpers for the exact schemes used
 * (e.g. `TRADE:<id>`, `COMMITMENT:<id>`, `DISCREPANCY:<category>:<dateKey>:<assetSymbol>`).
 * `statement` is the plain-English fact/quote itself — this is what the
 * evidence drawer shows the trader when they click a citation, and what a
 * validator can compare a report's claims against.
 */
export interface EvidenceItem {
  id: string;
  strength: EvidenceStrength;
  /** A short section/category label, e.g. "OVERRIDE_DISCIPLINE", "REFLECTION", "REPLAY_COMPARISON". */
  category: string;
  statement: string;
  /** Optional dateKey this item pertains to, for the evidence drawer's ordering/filtering. */
  dateKey?: string;
}

// ── Evidence Package sections (§5) ──────────────────────────────────────────

export interface EvidencePeriod {
  sessionId: string;
  reviewType: "WEEKLY" | "MONTHLY";
  startDate: string;
  endDate: string;
  finalized: boolean;
  strategyScopeName: string | null;
  assetScopeSymbols: string[];
}

/** OBJECTIVE — a narrow, purpose-built summary computed directly from Trade
 *  rows in the period; deliberately NOT the full Analytics engine output
 *  (§12 reuses read models conceptually, but the full Analytics payload is
 *  far larger than an evidence package should carry — see the evidence
 *  builder's own doc comment). */
export interface PerformanceSummary {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalR: number | null;
  averageR: number | null;
}

export interface SetupPerformanceEntry {
  evidenceId: string;
  setupTypeName: string;
  trades: number;
  winCount: number;
}

export interface StrategyPerformance {
  strategyName: string | null;
  strategyVersion: number | null;
  setupBreakdown: SetupPerformanceEntry[];
}

/** DERIVED — average of Trade.executionPercent (strategy-execution
 *  adherence frozen per trade), OBJECTIVE at the per-trade level but
 *  summarized here. */
export interface PlanningAdherence {
  averageExecutionPercent: number | null;
  tradesWithSetupType: number;
  tradesTotal: number;
}

export interface ValidationOverrides {
  validatedCount: number;
  overriddenCount: number;
  notValidatedCount: number;
  /** Evidence ids for the OVERRIDDEN trades specifically — the analyst can
   *  cite individual overrides, not just the aggregate count. */
  overrideEvidenceIds: string[];
}

export interface BehaviouralEvidenceEntry {
  evidenceId: string;
  dateKey: string;
  label: string;
  polarity: "POSITIVE" | "NEGATIVE";
}

export interface BehaviouralEvidence {
  negativeCount: number;
  positiveCount: number;
  entries: BehaviouralEvidenceEntry[];
}

/** TRADER_REPORTED — a self-answered questionnaire score, never treated as
 *  an objective psychological measurement. */
export interface PsychologyEntry {
  evidenceId: string;
  dateKey: string;
  percent: number;
  grade: string;
}

export interface PsychologySummary {
  averagePercent: number | null;
  entries: PsychologyEntry[];
}

export interface DiscrepancyEvidenceEntry {
  evidenceId: string;
  category: string;
  dateKey: string;
  assetSymbol: string;
  description: string;
}

/** DERIVED — reuses Stage 15's DiscrepancyBuckets classification directly;
 *  the analyst is explicitly told a correctly-executed losing trade
 *  (Strategy Variance) is never a behavioral failure (§23). */
export interface DiscrepancyEvidence {
  strategyVarianceCount: number;
  executionDiscrepancyEntries: DiscrepancyEvidenceEntry[];
  behavioralDiscrepancyEntries: DiscrepancyEvidenceEntry[];
  confirmedMissedOpportunityEntries: DiscrepancyEvidenceEntry[];
}

export interface ReplayComparisonEvidence {
  evidenceId: string;
  isProvisional: boolean;
  matchedDecisionCount: number;
  sameDecisionCount: number;
  differentDecisionCount: number;
  discrepancy: DiscrepancyEvidence;
}

/** Shared with `BehaviorOccurrenceTrendEntry.currentTrend` (§Stage 20.1 §3)
 *  — the exact same trend vocabulary `classifyTrend` already produces
 *  (`domain/improvements/commitment-adherence.ts`), never a second
 *  parallel definition. */
export type EvidenceTrend = "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";

export interface CommitmentEvidenceEntry {
  evidenceId: string;
  title: string;
  category: string;
  status: string;
  currentAdherencePercent: number | null;
  currentApplicableObservations: number;
  previousAdherencePercent: number | null;
  trend: EvidenceTrend;
  periodsActive: number;
  resolutionEligible: boolean;
  /** The commitment's stable automatic-evidence rule key
   *  (`AutomaticEvidenceRuleKey`), when this commitment is backed by one —
   *  null for a manual/unmapped commitment. Lets the analyst (and
   *  `commitmentBehaviorCrossChecks`) pair a commitment with its own
   *  independent `behaviorOccurrenceTrends` series without guessing from
   *  title text (Stage 20.1 §9). */
  ruleKey: string | null;
}

export interface ReflectionEntry {
  evidenceId: string;
  dateKey: string;
  wentWell: string | null;
  toImprove: string | null;
  lesson: string | null;
  carryForward: string | null;
}

export interface PeriodReflection {
  evidenceId: string;
  wentWell: string | null;
  toImprove: string | null;
  focusNextPeriod: string | null;
}

export interface TradeReflectionEntry {
  evidenceId: string;
  dateKey: string;
  whatWentWell: string | null;
  whatWentWrong: string | null;
  whatCouldImprove: string | null;
  wouldTakeAgain: boolean | null;
}

export interface ReflectionEvidence {
  periodReflection: PeriodReflection | null;
  dailyReflections: ReflectionEntry[];
  tradeReflections: TradeReflectionEntry[];
}

/** A small, deterministic slice of context beyond the current period (§11)
 *  — summarized trends only, never a dump of historical trades. */
export interface HistoricalContext {
  previousPeriodPerformance: PerformanceSummary | null;
  previousPeriodAdherencePercent: number | null;
}

export interface TruncationNote {
  field: string;
  totalAvailable: number;
  included: number;
  selectionRule: string;
}

// ── Longitudinal behavior occurrence (Stage 20.1 §2-6) ──────────────────────

export interface BehaviorOccurrenceTrendPoint {
  /** dateKey — the review period's own start date, same series Stage 19.1
   *  already keys its per-period breach counts by. */
  periodStart: string;
  breachCount: number;
}

/**
 * One automatic-evidence rule's longitudinal, review-type-scoped breach
 * series (§2-4) — packaged directly from
 * `buildImprovementAnalytics(...).behaviourOccurrence`, never recomputed.
 * Weekly and monthly are NEVER blended into one series: `reviewType` here
 * is always the evidence package's own period.reviewType, matching how
 * `buildImprovementAnalytics` was invoked (§4).
 *
 * Strength: DERIVED, not OBJECTIVE (§5) — each point is a deterministic
 * AGGREGATION (a count of BREACHED daily observations within one review
 * period) one layer removed from the individual OBJECTIVE
 * FOLLOWED/BREACHED facts underneath it, exactly the same OBJECTIVE→DERIVED
 * boundary a commitment's own `trend` already crosses. The evidence item
 * for each entry is tagged DERIVED accordingly.
 */
export interface BehaviorOccurrenceTrendEntry {
  evidenceId: string;
  ruleKey: string;
  label: string;
  reviewType: "WEEKLY" | "MONTHLY";
  /** Bounded, most-recent-first is NOT how these are stored — chronological
   *  ascending (oldest -> newest), matching the source series and easiest
   *  for both a human and the model to read as a left-to-right trend. */
  points: BehaviorOccurrenceTrendPoint[];
  /** Reused verbatim from the matching active/resulted commitment's own
   *  lineage `trend` (never recomputed here) when a commitment currently
   *  backs this exact rule key — null when no commitment tracks it right
   *  now, in which case the analyst must not assert a trend at all (§7-8:
   *  "insufficient evidence" is a valid, expected answer). */
  currentTrend: EvidenceTrend | null;
  /** The applicable-observations denominator behind `currentTrend`, from
   *  the same matching commitment — lets the analyst recognize a
   *  small-sample trend rather than treat 1-2 observations as proof. */
  currentApplicableObservations: number | null;
}

export type CommitmentBehaviorSignal = "CONVERGING" | "CONTRADICTORY" | "NEUTRAL";

/**
 * Pairs one active commitment's own adherence with its rule's independent
 * `behaviorOccurrenceTrends` series (Stage 20.1 §9) so the analyst can
 * compare "what the trader committed to" against "what the system
 * independently observed" without recomputing either side itself.
 *
 * `signal` is computed HERE, deterministically and conservatively — never
 * invented by the model:
 * - CONTRADICTORY: current adherence is a perfect 100% (>=3 applicable
 *   observations) for THIS period, yet the paired trend series still has a
 *   breach recorded for this EXACT SAME period (possible because the
 *   trend aggregates every lineage ever tagged with this rule key, not
 *   only the currently-active one — e.g. an older, separate commitment
 *   for the same rule breached this period). Deliberately period-aligned,
 *   not merely "the most recent tracked point": the underlying series
 *   only records periods with >=1 breach, so a period with zero breaches
 *   never appears at all — comparing against the bare last array entry
 *   would flag a stale, long-past breach as if it contradicted today. A
 *   real, non-stale structural discrepancy worth surfacing honestly,
 *   never silently resolved either way.
 * - CONVERGING: current adherence is otherwise healthy (>=70%, >=3
 *   applicable observations) AND the paired trend's breach counts are
 *   non-increasing across its available points with the most recent point
 *   lower than the first — supportive, convergent evidence.
 * - NEUTRAL: neither condition is met (including simply not enough trend
 *   points to say anything) — the analyst must not manufacture a signal
 *   Traditorium itself doesn't have evidence for.
 */
export interface CommitmentBehaviorCrossCheckEntry {
  evidenceId: string;
  commitmentTitle: string;
  ruleKey: string;
  currentAdherencePercent: number | null;
  currentApplicableObservations: number;
  /** Oldest -> newest, copied from the paired `BehaviorOccurrenceTrendEntry.points`. */
  recentBreachCounts: number[];
  signal: CommitmentBehaviorSignal;
}

/**
 * Stage 20.1 §17 — a small, deterministic summary of what evidence actually
 * went into the package, computed once at build time from real counts (not
 * derived from the flat `evidenceIndex`, which loses fidelity — e.g. not
 * every trade gets its own evidence item). Persisted alongside a generated
 * report (never re-derived for a historical report) so the coverage line
 * a trader sees on an old report always describes THAT report's evidence,
 * never today's.
 */
export interface EvidenceCoverageSummary {
  tradesIncluded: number;
  behavioralEventsIncluded: number;
  discrepancyEventsIncluded: number;
  commitmentsIncluded: number;
  replayAvailable: boolean;
  psychologyAvailable: boolean;
  longitudinalBehaviorAvailable: boolean;
}

/**
 * The full, provider-independent evidence package for one review period
 * (§5, §10). Deliberately NOT a Prisma serialization — every field here is
 * deliberately extracted/summarized by `buildTraderReviewEvidencePackage`.
 * `evidenceIndex` is the flat lookup every citation in an
 * `TraderReviewAnalystReport` is validated against (§20).
 */
export interface TraderReviewEvidencePackage {
  packageVersion: string;
  period: EvidencePeriod;
  performanceSummary: PerformanceSummary;
  strategyPerformance: StrategyPerformance;
  planningAdherence: PlanningAdherence;
  validationOverrides: ValidationOverrides;
  behavioralEvidence: BehaviouralEvidence;
  psychology: PsychologySummary;
  replayComparison: ReplayComparisonEvidence | null;
  activeCommitments: CommitmentEvidenceEntry[];
  commitmentResults: CommitmentEvidenceEntry[];
  longitudinalImprovement: {
    reviewType: "WEEKLY" | "MONTHLY";
    activeCount: number;
    completedCount: number;
    improvingCount: number;
    decliningCount: number;
    averageAdherencePercent: number | null;
  };
  reflections: ReflectionEvidence;
  historicalContext: HistoricalContext;
  /** Stage 20.1 §2-6 — bounded, deterministically-selected longitudinal
   *  occurrence trends reused from Stage 19.1's canonical read model. */
  behaviorOccurrenceTrends: BehaviorOccurrenceTrendEntry[];
  /** Stage 20.1 §9. */
  commitmentBehaviorCrossChecks: CommitmentBehaviorCrossCheckEntry[];
  /** Stage 20.1 §17 — persisted verbatim alongside a generated report. */
  coverageSummary: EvidenceCoverageSummary;
  /** Deterministic, explicit unavailable-category flags (§27) — the analyst
   *  must never infer missing information silently. */
  missingData: string[];
  truncation: TruncationNote[];
  evidenceIndex: Record<string, EvidenceItem>;
}

// ── Analyst Report (§18) ─────────────────────────────────────────────────

export type AnalystConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface AnalystFinding {
  title: string;
  explanation: string;
  evidenceIds: string[];
  confidence: AnalystConfidence;
  category: string;
}

export interface AnalystQuestion {
  question: string;
  relatedEvidenceIds: string[];
}

export interface EvidenceCoverage {
  totalEvidenceItems: number;
  citedEvidenceItems: number;
}

/**
 * The validated structured contract the AI must return (§18, §28) — never
 * arbitrary Markdown. `evidenceCoverage` is computed by the application
 * AFTER citation validation, never self-reported by the model (see
 * `report-schema.ts`).
 */
export interface TraderReviewAnalystReport {
  periodSummary: string;
  strengths: AnalystFinding[];
  concerns: AnalystFinding[];
  recurringPatterns: AnalystFinding[];
  improvementProgress: AnalystFinding[];
  priorityFocus: AnalystFinding[];
  questionsForReflection: AnalystQuestion[];
  evidenceCoverage: EvidenceCoverage;
}

// ── Provider abstraction (§15) ──────────────────────────────────────────────

export type AnalystFailureReason =
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "INVALID_CITATIONS"
  | "REFUSED"
  | "PACKAGE_TOO_LARGE"
  | "UNKNOWN_ERROR";

export interface AnalystReportSuccess {
  status: "COMPLETE";
  report: TraderReviewAnalystReport;
  provider: string;
  model: string;
}

export interface AnalystReportFailure {
  status: "FAILED";
  reason: AnalystFailureReason;
  /** Trader-facing — never a raw stack trace or provider internals. */
  error: string;
}

export type AnalystOutcome = AnalystReportSuccess | AnalystReportFailure;

/**
 * Provider-independent contract (§15) — Edge UI never talks to a model
 * vendor directly. `analyzeReview` receives ONLY the derived evidence
 * package, never raw database access.
 */
export interface TraderReviewAnalystProvider {
  readonly name: string;
  readonly version: string;
  /** Cheap, synchronous — no network call. */
  isAvailable(): boolean;
  analyzeReview(evidence: TraderReviewEvidencePackage): Promise<AnalystOutcome>;
}
