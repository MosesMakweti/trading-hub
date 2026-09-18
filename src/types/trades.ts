import type { TagColor } from "@prisma/client";

import type { SetupRating } from "@/domain/trades/setup-score";
import type { LeakageEvent } from "@/domain/analytics/counterfactual-engine";

/** A selected confluence / execution tag, resolved with its color (from the trade's
 * frozen strategy snapshot) so it renders as a colored chip everywhere. */
export interface SelectedTagDTO {
  name: string;
  color: TagColor;
}

/** A planned profit target from the confirmed TradingView Trade Plan — the
 *  sole source for TP display everywhere outside the plan workspace itself
 *  (no separate manual "TP hit" tracking exists). */
export interface PlannedTargetDTO {
  targetOrder: number;
  label: string;
  targetPrice: number;
}

/** Per-trade discrepancy breakdown (Counterfactual model). A correctly-executed
 * trade — win OR loss — has avoidableR 0 and no leakages. R-multiples. */
export interface TradeDiscrepancyDTO {
  actualR: number | null;
  /** What a disciplined execution of this trade would have produced. */
  processPerfectR: number;
  /** Measurable recoverable R (≥ 0). 0 for a clean trade. */
  avoidableR: number;
  /** R won by breaching process (a lucky breach) — surfaced, never rewarded. */
  unearnedR: number;
  processBreach: boolean;
  validSetup: boolean;
  leakages: LeakageEvent[];
  /** The most material leakage (largest measured, else first flagged) for the badge. */
  primary: LeakageEvent | null;
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
  tradeNumber: number;
  assetSymbol: string;
  executionMinutes: number;
  direction: "LONG" | "SHORT";
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;
  expectedRR: number | null;
  actualRR: number | null;
  targets: PlannedTargetDTO[];
  accounts: {
    name: string;
    riskInputType: "PERCENT" | "AMOUNT";
    riskValue: number;
    // Stage C: null = not settled / not calculable yet — never a fake 0.
    closingPnlGross: number | null;
    closingPnlNet: number | null;
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

  // Journal rebuild (Stage 9 §7) — Setup Type / Validation Shield (frozen,
  // Stage 4), lifecycle state (Stage 7/8), pre-trade mood (Stage 5), and
  // behaviour labels (Stage 7) — enough to scan a trade's whole story from
  // the Journal's day-level list without opening it.
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  setupTypeName: string | null;
  validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null;
  preTradeMoodTags: string[];
  behaviourLabels: { name: string; polarity: "POSITIVE" | "NEGATIVE"; color: TagColor }[];
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
  // Stage C: null = not settled / not calculable yet — never a fake 0.
  closingPnlGross: number | null;
  closingPnlNet: number | null;
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
  /** Frozen at first entry (Stage 4 §10) — the day's DailyAssetAnalysis
   *  finalBias for this asset at the moment the trade was created. Never
   *  re-resolved from a since-changed live analysis. */
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;

  expectedRR: number | null;
  actualRR: number | null;
  targets: PlannedTargetDTO[];

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
  // Stage C: null = not settled / not calculable yet (see
  // TradeAccountAllocation's doc comment in schema.prisma) — never coalesce
  // to 0, that's what caused the Performance Account's $0.00 display bug.
  performancePnlGross: number | null;
  performancePnlNet: number | null;

  /** Today V2 Phase 2 (§5/§6/§10) — the frozen PerformanceRiskSnapshot, once
   *  an actual entry has locked one. Null before that (still just a Trade
   *  Idea — see the Performance Account's pre-lock presentation in
   *  performance-account-row.tsx instead). `initialStop` is the immutable
   *  original-risk fact (Stage C.1); `actualStopLoss` (below) is the same
   *  mutable column used for ongoing stop management post-lock — Trade
   *  Execution presents them side by side as "Initial stop" vs "Current
   *  stop," never conflating the two. */
  performanceRisk: {
    riskPercent: number;
    riskAmount: number;
    initialStop: number | null;
    /** Realized R once fully closed; null while pending. Sourced from the
     *  same frozen snapshot the settlement engine writes to, never re-derived. */
    realizedR: number | null;
    settled: boolean;
  } | null;

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
  actualStopLoss: number | null;
  executionNotes: string | null;
  whatWentWell: string | null;
  whatWentWrong: string | null;
  whatSurprisedMe: string | null;
  whatCouldImprove: string | null;
  wouldTakeAgain: boolean | null;
  tradeIntent: "PLANNED" | "FOMO" | "REVENGE" | "BOREDOM" | "IMPULSE" | "MANUAL_OVERRIDE" | null;

  // Phase 5 — strategy-adherence self-score (answers keyed by ADHERENCE_QUESTIONS).
  adherenceAnswers: Record<string, boolean>;
  adherencePercent: number | null;

  psychology: {
    rawScore: number;
    percent: number;
    grade: "A" | "B" | "C" | "D" | "F";
  } | null;
  // Raw Honest-Questionnaire answers (keyed by PSYCHOLOGY_QUESTIONS) so the
  // Trade Review panel can seed from saved state and let the trader complete
  // or revise them. `{}` when never answered.
  psychologyAnswers: Record<string, string | number>;

  // Optional gallery preview (a representative attached image). Populated only
  // where the gallery needs it (see listTradePreviewImages); the mapper leaves it
  // undefined since media lives in the universal attachment system, not on Trade.
  previewImageUrl?: string | null;

  // Trade Review overhaul (Stage 7) — see Trade.reviewLifecycleStatus's schema
  // doc comment for why this is a separate axis from `status` below.
  reviewLifecycleStatus: "FULLY_CLOSED" | "PARTIALLY_CLOSED" | "STILL_HOLDING" | "CANCELLED_NEVER_TRIGGERED" | null;
  cancellationReason: string | null;

  // Pre-Trade Mood Snapshot (Stage 5).
  preTradeMoodTags: string[];
  preTradeMoodIntensity: number | null;
  preTradeMoodNote: string | null;

  status: TradeStatus;
  createdAt: string; // ISO — trade logged
  updatedAt: string; // ISO — last edit
  executedAt: string; // ISO — in-market execution (tradeDate + executionMinutes)
  closedAt: string | null; // ISO — result first recorded
  reviewedAt: string | null; // ISO — first reviewed
}
