import type { SetupRating } from "@/domain/trades/setup-score";
import type { SelectedTagDTO } from "@/types/trades";

export type OpportunityStatus = "PENDING" | "EXECUTED" | "MISSED" | "INVALIDATED" | "EXPIRED";

export type MissReason =
  | "FEAR"
  | "HESITATION"
  | "FOMO_ELSEWHERE"
  | "DISTRACTED"
  | "MISSED_ALERT"
  | "LATE_CONFIRMATION"
  | "RISK_CONCERNS"
  | "TECHNICAL_ISSUE"
  | "RULE_UNCERTAINTY"
  | "INTENTIONAL_SKIP"
  | "OTHER";

export type MissedOutcome = "MISSED_WIN" | "MISSED_LOSS" | "MISSED_BREAKEVEN" | "MISSED_UNDETERMINED";

/** Human labels for the miss reasons (behavioral tags), ordered for the picker. */
export const MISS_REASON_LABELS: Record<MissReason, string> = {
  FEAR: "Fear",
  HESITATION: "Hesitation",
  FOMO_ELSEWHERE: "Chasing / FOMO elsewhere",
  DISTRACTED: "Distracted",
  MISSED_ALERT: "Wasn't watching / no alert",
  LATE_CONFIRMATION: "Saw it too late",
  RISK_CONCERNS: "Stood aside on risk",
  TECHNICAL_ISSUE: "Technical / platform issue",
  RULE_UNCERTAINTY: "Unsure it qualified",
  INTENTIONAL_SKIP: "Intentional, disciplined pass",
  OTHER: "Other",
};

export const MISSED_OUTCOME_LABELS: Record<MissedOutcome, string> = {
  MISSED_WIN: "Would have won",
  MISSED_LOSS: "Would have lost",
  MISSED_BREAKEVEN: "Breakeven",
  MISSED_UNDETERMINED: "Couldn't tell",
};

/** One opportunity as rendered in the Journal day list. */
export interface OpportunityListItemDTO {
  id: string;
  status: OpportunityStatus;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  timeframe: string | null;

  strategyId: string | null;
  strategyName: string | null;

  // Frozen setup scoring (mirrors the trade card).
  setupScore: number | null;
  setupRating: SetupRating | null;
  setupValid: boolean | null;
  missingMandatory: string[];
  confluenceLabels: SelectedTagDTO[];
  executionLabels: SelectedTagDTO[];

  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTarget: number | null;
  plannedRR: number | null;
  expectedExpectancyR: number | null;

  // MISSED-only.
  missReason: MissReason | null;
  missNote: string | null;
  missedOutcome: MissedOutcome | null;
  missedRealizedR: number | null;

  // EXECUTED-only link.
  executedTrade: { id: string; tradeNumber: number | null; actualRR: number | null } | null;

  /** Today V3 (Phase 4) — the cancelled idea this missed opportunity was
   *  explicitly recorded from (provenance only), else null. */
  originTrade: { id: string; tradeNumber: number | null } | null;
}
