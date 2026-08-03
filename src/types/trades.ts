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
  entryModelNames: string[];
  confluenceLabels: string[];
  executionLabels: string[];
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
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;

  expectedRR: number;
  actualRR: number | null;
  hitTP1: boolean;
  hitTP2: boolean;
  hitTP3: boolean;
  hitFullTP: boolean;

  entryModelNames: string[];
  confluenceLabels: string[];
  executionLabels: string[];

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

/** Strategy-adherence prompts. Displayed read-only in Phase 1; a scoring system
 *  plugs in later without changing this list or the panel's layout. */
export const STRATEGY_ADHERENCE_QUESTIONS = [
  "Did I follow my strategy?",
  "Did I follow my entry model?",
  "Did I follow my trade-management rules?",
  "Did I remain patient?",
  "Did I execute according to plan?",
] as const;
