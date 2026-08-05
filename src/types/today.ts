import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";
import type { RoutineProgress, RoutineSnapshot } from "@/domain/today/routine-snapshot";

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
    watchlistSymbols: string[];
    keyLevels: unknown; // Tiptap JSON or null
    riskBudgetPercent: number | null;
  };
  analytics: StrategyPerformanceSummary & { netPnl: number };
}

/** The Today workspace's day record (TradeOS V2 backbone). */
export interface TradingDayDTO {
  id: string;
  dateKey: string;
  status: TradingDayStatus;
  prepCompletedAt: string | null; // ISO
  planCompletedAt: string | null;
  analyzedAt: string | null;
  archivedAt: string | null;
}

/** Today's Trading Plan section data. The watchlist template comes from the
 *  user's Assets; state on TradingDay. */
export interface TodaysPlanDTO {
  assets: { id: string; symbol: string; label: string | null }[];
  bias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  conviction: number | null; // 1–5
  watchlistFocus: string[]; // Asset ids
  keyLevels: unknown; // Tiptap JSON or null
  riskBudgetPercent: number | null;
  planRiskLimit: number | null; // plan's maxDailyRiskPercent (display hint)
  planComplete: boolean;
}
