import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";
import type { RoutineProgress, RoutineSnapshot } from "@/domain/today/routine-snapshot";
import type { DirectionalEvidenceSummary } from "@/domain/today/directional-evidence";

export type TradingDayStatus = "ACTIVE" | "ARCHIVED";

/** Day-scoped analytics for the Today workspace (P5b). Reuses the shared
 *  performance summary + the day's net PnL in dollars; `analyzed` is the
 *  workflow flag (day.analyzedAt != null). */
export interface DailyAnalyticsDTO extends StrategyPerformanceSummary {
  netPnl: number;
  analyzed: boolean;
}

/** Read-only recap of a finalized trading day, shown on the Journal day page
 *  (P7). Null when the day was never opened in the Today workspace. */
export interface JournalDayRecapDTO {
  status: TradingDayStatus;
  prepDone: boolean;
  planDone: boolean;
  analyzeDone: boolean;
  routine: {
    snapshot: RoutineSnapshot | null; // the frozen routine for that day
    readyAt: string | null; // ISO — when "I am ready to trade" was confirmed
    progress: RoutineProgress;
  };
  plan: {
    bias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
    conviction: number | null;
    keyLevels: unknown; // Tiptap JSON or null
    riskBudgetPercent: number | null;
  };
  analytics: StrategyPerformanceSummary & { netPnl: number };
}

/** The Today workspace's day record (Traditorium V2 backbone). */
export interface TradingDayDTO {
  id: string;
  dateKey: string;
  status: TradingDayStatus;
  prepCompletedAt: string | null; // ISO
  planCompletedAt: string | null;
  analyzedAt: string | null;
  archivedAt: string | null;
}

/** One Directional Evidence item (Stage 11 §7-13) — a trader-defined,
 *  optional bullish/bearish checklist row backing the suggested-bias feature. */
export interface DirectionalEvidenceItemDTO {
  id: string;
  label: string;
  direction: "BULLISH" | "BEARISH";
  checked: boolean;
  note: string | null;
}

/** One asset's analysis for a trading day (Stage 2; Stage 11 Daily Market
 *  Plan consolidation — now the single source of truth for "Today's Assets"
 *  and Areas of Interest). The three "read" biases (htf/session/fundamental)
 *  are independent — never forced to agree with each other or with
 *  `finalBias`, which is the trader's own trading decision in a different
 *  vocabulary (LONG/SHORT/NEUTRAL). `evidenceSummary` is a pure derivation of
 *  `evidenceItems` (domain/today/directional-evidence.ts) — never a second,
 *  independently-entered number. */
export interface DailyAssetAnalysisDTO {
  id: string;
  assetSymbol: string;
  marketStructure: unknown; // Tiptap JSON or null
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  sessionBias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  fundamentalBias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  fundamentalNotes: unknown; // Tiptap JSON or null — asset-specific fundamental evidence
  finalBias: "LONG" | "SHORT" | "NEUTRAL" | null;
  notes: unknown; // Tiptap JSON or null
  keyLevels: unknown; // Tiptap JSON or null — Areas of Interest
  evidenceItems: DirectionalEvidenceItemDTO[];
  evidenceSummary: DirectionalEvidenceSummary;
}

/** Today's Trading Plan section data. State on TradingDay. */
export interface TodaysPlanDTO {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  conviction: number | null; // 1–5
  keyLevels: unknown; // Tiptap JSON or null
  riskBudgetPercent: number | null;
  planRiskLimit: number | null; // plan's maxDailyRiskPercent (display hint)
  planComplete: boolean;

  // Daily Outlook (Stage 1) — Today's Intent
  lookingFor: unknown; // Tiptap JSON or null
  watchlist: string[];
  activeSessions: string[];
  importantConditions: unknown; // Tiptap JSON or null
  stayOutConditions: unknown; // Tiptap JSON or null

  // Daily Outlook — Risk / Boundaries
  maxTradesPerDay: number | null;

  // Daily Outlook — News & Fundamentals. dailyFundamentalOutlook is a general
  // macro note for the day, not a single bullish/neutral/bearish bias — see
  // the schema comment on TradingDay for why.
  newsAcknowledged: boolean;
  newsNotes: unknown; // Tiptap JSON or null
  dailyFundamentalOutlook: unknown; // Tiptap JSON or null
}
