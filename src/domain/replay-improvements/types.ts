/**
 * Improvements & Carry-Forward Commitments (Stage 16) — pure DTOs. Every
 * value here is DERIVED from the Stage 15.2 `ActualVsReplayComparison`
 * model; nothing in this module queries Prisma or re-derives comparison
 * math of its own (§3 — "findings are derived, not recommendations").
 *
 * Findings are FACTUAL statements ("3 Actual overrides vs 0 Replay
 * overrides"), never commands. Suggestions are the one deliberately
 * rule-based, deterministic step from finding -> proposed commitment text —
 * still not AI coaching (§30): every suggestion traces to a named rule and
 * a minimum evidence threshold (§11-12), and the trader must explicitly
 * Add/Edit/Dismiss it (§9) — nothing here is ever auto-created as a durable
 * commitment.
 */

export type FindingSeverity = "HIGH" | "MEDIUM" | "INFORMATIONAL";

export type FindingCategory =
  | "EXECUTION"
  | "BEHAVIOR"
  | "OPPORTUNITY"
  | "STRATEGY_VARIANCE"
  | "VALIDATION"
  | "POSITIVE";

/**
 * One factual finding. `severity` reflects evidence strength (recurrence,
 * defensible R impact, trader-controlled vs market-controlled), never a
 * blame judgment — a STRATEGY_VARIANCE or POSITIVE finding is always
 * INFORMATIONAL, never ranked as a behavioral failure (§4-5).
 */
export interface Finding {
  /** A stable identifier for the underlying pattern (e.g.
   *  "STOP_WIDENING", "STRATEGY_VARIANCE") — used for deduplication and to
   *  link a suggestion back to the finding that produced it. */
  key: string;
  category: FindingCategory;
  severity: FindingSeverity;
  /** The factual statement itself — e.g. "4 execution discrepancies; early
   *  exits accounted for 1.4R of defensible avoidable discrepancy." */
  statement: string;
  /** Supporting facts, one line each — e.g. "3 Actual overrides vs 0 Replay
   *  overrides", "XAUUSD Type A produced the most decision divergence." */
  evidence: string[];
  count: number;
  /** Only set when a defensible R number exists (never fabricated). */
  rImpact: number | null;
}

export type CommitmentCategory = "EXECUTION" | "BEHAVIOR" | "PROCESS" | "OPPORTUNITY" | "STRATEGY" | "RISK";
export type CommitmentPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * A rule-based, deterministic proposal (§9) — never persisted on its own;
 * the trader must explicitly turn it into a durable `EdgeReviewCommitment`
 * (Add), change its text/category/priority first (Edit), or discard it
 * (Dismiss). `ruleKey` is the stable dedup key (§12) — the same underlying
 * pattern (e.g. several stop-widening events) always produces exactly one
 * suggestion under one key, however many events feed it.
 */
export interface SuggestedCommitment {
  ruleKey: string;
  category: CommitmentCategory;
  title: string;
  description: string;
  priority: CommitmentPriority;
  evidence: string[];
  /** The finding key(s) this suggestion was derived from. */
  sourceFindingKeys: string[];
}

export interface ImprovementsSummary {
  executionFindingCount: number;
  behaviorFindingCount: number;
  confirmedMissedOpportunityCount: number;
  avoidableDiscrepancyR: number;
  suggestedCommitmentCount: number;
}

export interface ImprovementsSynthesis {
  summary: ImprovementsSummary;
  findings: Finding[];
  positiveFindings: Finding[];
  strategyVarianceFindings: Finding[];
  suggestions: SuggestedCommitment[];
}
