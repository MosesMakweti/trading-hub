import type { TagColor } from "@prisma/client";

import type { SetupRating } from "@/domain/trades/setup-score";
import type { Deviation } from "@/domain/analytics/deviation-engine";

/** A selected confluence / execution tag, resolved with its color (from the trade's
 * frozen strategy snapshot) so it renders as a colored chip everywhere. */
export interface SelectedTagDTO {
  name: string;
  color: TagColor;
}

/** Per-trade Discrepancy-Gap breakdown (from the Execution Engine). Null when the
 * trade's strategy has no expectancy benchmark set. R-multiples. */
export interface TradeDiscrepancyDTO {
  executionScore: number | null;
  strategyAdherence: number | null;
  expectedR: number | null;
  actualR: number | null;
  gapR: number | null;
  recoverableR: number | null;
  primaryDeviation: Deviation | null; // the biggest planned-vs-actual slip, if any
}

/** Strategy-adherence / trade-quality scores. Null when the strategy defined no
 * items of that kind (or the trade had no strategy). NOT a market prediction. */
export interface AdherenceScoresDTO {
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
}

export interface TradeListItemDTO {
  id: string;
  assetSymbol: string;
  executionMinutes: number;
  direction: "LONG" | "SHORT";
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;
  expectedRR: number;
  actualRR: number | null;
  hitTP1: boolean;
  hitTP2: boolean;
  hitTP3: boolean;
  hitFullTP: boolean;
  accounts: {
    name: string;
    riskInputType: "PERCENT" | "AMOUNT";
    riskValue: number;
    closingPnlGross: number;
    closingPnlNet: number;
  }[];
  entryModelName: string | null;
  confluenceLabels: SelectedTagDTO[];
  executionLabels: SelectedTagDTO[];
  // Combined strategy-adherence / trade-quality score (null when no strategy set).
  tradeQualityPercent: number | null;
  // Weighted confluence setup score + rating (null when the strategy has no weights).
  setupScore: number | null;
  setupRating: SetupRating | null;
  setupValid: boolean | null;
  // Per-trade Discrepancy Gap (null when the strategy has no expectancy benchmark).
  discrepancy: TradeDiscrepancyDTO | null;
  // Strategy the trade was taken under (from the snapshot); strategyId links to
  // the live strategy only while it still exists.
  strategyName: string | null;
  strategyId: string | null;
  psychology: {
    rawScore: number;
    percent: number;
    grade: "A" | "B" | "C" | "D" | "F";
  } | null;
}

// ── Trade Workspace (case-file view) ─────────────────────────────────────────
// Phase 1 is a structural UI refactor over the SAME Trade record — no schema
// change. It organizes existing fields into sections and marks not-yet-captured
// fields (planned prices, market context, actual prices, strategy link, adherence
// scoring) as placeholders for later phases. See docs/TRADE_WORKSPACE.md.

/** Lifecycle stage, derived in Phase 1 from existing data (no DB status column yet). */
export type TradeStatus = "OPEN" | "CLOSED" | "REVIEWED";

export interface TradeWorkspaceAccountDTO {
  name: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE" | "PERFORMANCE";
  riskInputType: "PERCENT" | "AMOUNT";
  riskValue: number;
  closingPnlGross: number;
  closingPnlNet: number;
}

export interface TradeWorkspaceImageDTO {
  id: string;
  category: "ANALYSIS" | "BEFORE" | "AFTER";
  url: string;
}

export interface TradeWorkspaceDTO {
  id: string;
  dateKey: string;
  tradeNumber: number;

  assetSymbol: string;
  assetLabel: string | null;
  direction: "LONG" | "SHORT";
  executionMinutes: number;
  sessionName: string | null;
  sessionColor: TagColor | null; // the session's assigned color (from the strategy snapshot)
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;

  expectedRR: number;
  actualRR: number | null;
  hitTP1: boolean;
  hitTP2: boolean;
  hitTP3: boolean;
  hitFullTP: boolean;

  entryModelName: string | null;
  confluenceLabels: SelectedTagDTO[];
  executionLabels: SelectedTagDTO[];

  // SOT strategy-adherence / trade-quality scores (selected vs the strategy's
  // frozen expected set). Null per-kind when the strategy defined none.
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;

  // Weighted confluence setup scoring (frozen at save time).
  setupScore: number | null;
  setupRating: SetupRating | null;
  setupValid: boolean | null;
  missingMandatory: string[]; // missing core confluences (for the "Invalid Setup" state)

  // Strategy Lab reference + historical snapshot (Phase 4). name/version are the
  // frozen snapshot (shown even if the strategy was later deleted); strategyId is
  // the live link, null once the strategy no longer exists.
  strategyId: string | null;
  strategyName: string | null;
  strategyVersion: number | null;

  accounts: TradeWorkspaceAccountDTO[]; // includes the Performance Account allocation
  performancePnlGross: number;
  performancePnlNet: number;

  // Existing free-text notes, mapped into Idea / Review sections.
  preTradeNotes: string | null; // psychPreTradeMindset
  postTradeReflection: string | null; // psychPostTradeReflection
  lessonsLearned: string | null; // psychLessonsLearned
  whatToWorkOn: string | null; // psychWhatToWorkOn

  // Phase 2 case-file fields — editable inline in the workspace sections.
  plannedEntry: number | null;
  plannedStopLoss: number | null;
  plannedTarget: number | null;
  marketContext: string | null;
  areasOfInterest: string | null;
  reasonForTrade: string | null;
  actualEntry: number | null;
  actualExit: number | null;
  executionNotes: string | null;
  whatWentWell: string | null;
  whatWentWrong: string | null;
  whatSurprisedMe: string | null;
  wouldTakeAgain: boolean | null;

  // Phase 5 — strategy-adherence self-score (answers keyed by ADHERENCE_QUESTIONS).
  adherenceAnswers: Record<string, boolean>;
  adherencePercent: number | null;

  psychology: {
    rawScore: number;
    percent: number;
    grade: "A" | "B" | "C" | "D" | "F";
  } | null;

  images: TradeWorkspaceImageDTO[];

  status: TradeStatus;
  createdAt: string; // ISO — trade logged
  updatedAt: string; // ISO — last edit
  executedAt: string; // ISO — in-market execution (tradeDate + executionMinutes)
  closedAt: string | null; // ISO — result first recorded
  reviewedAt: string | null; // ISO — first reviewed
}
