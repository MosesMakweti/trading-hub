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

export interface CommitmentEvidenceEntry {
  evidenceId: string;
  title: string;
  category: string;
  status: string;
  currentAdherencePercent: number | null;
  currentApplicableObservations: number;
  previousAdherencePercent: number | null;
  trend: "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";
  periodsActive: number;
  resolutionEligible: boolean;
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
