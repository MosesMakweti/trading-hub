import type {
  EdgeReviewCommitmentCategory,
  EdgeReviewCommitmentDailyStatus,
  EdgeReviewCommitmentPriority,
  EdgeReviewCommitmentSource,
  EdgeReviewCommitmentStatus,
  ReplayReviewType,
} from "@prisma/client";

export type {
  EdgeReviewCommitmentCategory,
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
  completedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Today's carry-forward view (Stage 16 §15-16) — weekly and monthly kept
 *  as two clearly separate groups, never merged into one ambiguous list. */
export interface TodayCommitmentsDTO {
  weekly: EdgeReviewCommitmentDTO[];
  monthly: EdgeReviewCommitmentDTO[];
}
