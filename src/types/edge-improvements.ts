import type {
  EdgeReviewCommitmentCategory,
  EdgeReviewCommitmentDailyStateSource,
  EdgeReviewCommitmentDailyStatus,
  EdgeReviewCommitmentPriority,
  EdgeReviewCommitmentSource,
  EdgeReviewCommitmentStatus,
  ReplayReviewType,
} from "@prisma/client";

export type {
  EdgeReviewCommitmentCategory,
  EdgeReviewCommitmentDailyStateSource,
  EdgeReviewCommitmentDailyStatus,
  EdgeReviewCommitmentPriority,
  EdgeReviewCommitmentSource,
  EdgeReviewCommitmentStatus,
};

/** A durable, trader-approved commitment (Stage 16 §6-14). */
export interface EdgeReviewCommitmentDTO {
  id: string;
  replayReviewSessionId: string | null;
  reviewType: ReplayReviewType;
  periodStart: string; // dateKey
  category: EdgeReviewCommitmentCategory;
  title: string;
  description: string | null;
  priority: EdgeReviewCommitmentPriority;
  status: EdgeReviewCommitmentStatus;
  source: EdgeReviewCommitmentSource;
  sourceFindingType: string | null;
  evidenceSnapshot: string[] | null;
  /** Stage 19 §3/§6/§7 — cross-period lineage. Both null on a commitment
   *  that has never been continued/refined. */
  previousCommitmentId: string | null;
  lineageId: string | null;
  completedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Today's carry-forward view (Stage 16 §15-16) — weekly and monthly kept
 *  as two clearly separate groups, never merged into one ambiguous list.
 *  Stage 19 §17/§27/§28: a lineage carried forward by BOTH a finalized
 *  weekly and monthly review appears only under `weekly` — see
 *  `getActiveCommitmentsForToday`'s own dedup comment. */
export interface TodayCommitmentsDTO {
  weekly: EdgeReviewCommitmentDTO[];
  monthly: EdgeReviewCommitmentDTO[];
}

/** Stage 19 §6/§7/§14 — never a raw fraction: `adherencePercent` is always a
 *  whole number or `null` ("no applicable observations yet," never 0%). */
export interface AdherenceResultDTO {
  followed: number;
  breached: number;
  acknowledgedCount: number;
  applicableObservations: number;
  adherencePercent: number | null;
}

export type AdherenceTrend = "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";

/** Stage 19.1 §11 — one day's underlying evidence, explainable without ever
 *  exposing a raw JSON blob to the trader: `evidenceDescription` is always
 *  the pre-formatted human-readable sentence a SYSTEM row's `evidence`
 *  JSON carries (or null for a MANUAL row/no evidence recorded). */
export interface CommitmentObservationDTO {
  dateKey: string;
  status: EdgeReviewCommitmentDailyStatus;
  source: EdgeReviewCommitmentDailyStateSource;
  note: string | null;
  evidenceDescription: string | null;
  relatedTradeId: string | null;
}

export interface CommitmentLineageSegmentDTO {
  commitmentId: string;
  title: string;
  description: string | null;
  category: EdgeReviewCommitmentCategory;
  periodStart: string;
  reviewType: ReplayReviewType;
  status: EdgeReviewCommitmentStatus;
  adherence: AdherenceResultDTO;
  /** Only set once the segment is RETIRED — distinguishes "carried forward
   *  via Continue/Refine" from "genuinely dismissed," derived from lineage
   *  relationships rather than a dedicated status value (§4). */
  retirementReason: "SUPERSEDED" | "DISMISSED" | null;
  completedAt: string | null;
  retiredAt: string | null;
  /** §11 — chronological, ascending by dateKey. */
  observations: CommitmentObservationDTO[];
}

/** The full cross-period history for one behavioral objective (Stage 19
 *  §3-14, §24-25, §29-30; observation-level detail added Stage 19.1 §8-11).
 *  `resolutionEligible` is only ever a suggestion surfaced to the trader —
 *  nothing here mutates status (§24). */
export interface CommitmentLineageDTO {
  lineageId: string;
  headCommitmentId: string;
  segments: CommitmentLineageSegmentDTO[]; // chronological, oldest first
  current: AdherenceResultDTO;
  previous: AdherenceResultDTO | null;
  lifetime: AdherenceResultDTO;
  trend: AdherenceTrend;
  resolutionEligible: boolean;
}

/**
 * Stage 19.1 §3-7 — a compact, non-blocking reminder shown at the moment a
 * trader is about to repeat a behavior a commitment already targets.
 * Deliberately minimal: displaying this is NOT an observation (§7) — it
 * carries no adherence data and creates no daily state on its own.
 */
export interface ContextualReminderDTO {
  commitmentId: string;
  title: string;
  description: string | null;
  priority: EdgeReviewCommitmentPriority;
  reviewType: ReplayReviewType;
}

// ── Analytics → Improvement (Stage 19.1 §14-21) ─────────────────────────────
// Canonical read model — every number here is pre-computed server-side by
// `buildImprovementAnalytics` from the SAME domain functions Stage 19 uses
// (`computeAdherence`/`classifyTrend`); React only renders (§34).

export interface ImprovementOverviewDTO {
  activeCount: number;
  completedCount: number;
  improvingCount: number;
  decliningCount: number;
  /** Across lineages with ≥1 applicable (lifetime) observation ONLY — a
   *  lineage with zero observations is excluded from both the sum and the
   *  sample size, never averaged in as an implicit 0%. */
  averageAdherencePercent: number | null;
  averageAdherenceSampleSize: number;
}

export interface MostBreachedObjectiveDTO {
  lineageId: string;
  title: string;
  category: EdgeReviewCommitmentCategory;
  breachCount: number;
  applicableObservations: number;
  adherencePercent: number | null;
}

export interface LongestRunningObjectiveDTO {
  lineageId: string;
  title: string;
  category: EdgeReviewCommitmentCategory;
  periodsActive: number;
  firstIdentifiedDateKey: string;
}

export interface ImprovementRankingEntryDTO {
  lineageId: string;
  headCommitmentId: string;
  title: string;
  category: EdgeReviewCommitmentCategory;
  current: AdherenceResultDTO;
  previous: AdherenceResultDTO | null;
  trend: AdherenceTrend;
  periodsActive: number;
}

/** One automatic-evidence rule's breach count per review period — §19
 *  "behaviour occurrence trends," e.g. stop-widening breaches per week.
 *  Never uses trade outcome/PnL — pure BREACHED-observation counts. */
export interface BehaviourOccurrenceSeriesDTO {
  ruleKey: string;
  points: { periodStart: string; breachCount: number }[];
}

export interface ImprovementAnalyticsDTO {
  reviewType: ReplayReviewType;
  overview: ImprovementOverviewDTO;
  mostBreached: MostBreachedObjectiveDTO | null;
  longestRunning: LongestRunningObjectiveDTO | null;
  /** Active lineages only, one row per lineage (its current head). */
  rankings: ImprovementRankingEntryDTO[];
  behaviourOccurrence: BehaviourOccurrenceSeriesDTO[];
}
