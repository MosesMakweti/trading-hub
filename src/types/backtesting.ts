import type { RunProgress } from "@/domain/backtesting/run-calendar";
import type { StrategyDriftState } from "@/domain/backtesting/strategy-drift";

export type BacktestRunStatusValue = "ACTIVE" | "COMPLETED" | "ARCHIVED";

/** One Backtest Run as the Overview / run header render it. Every number is
 *  derived from the run's own scoped rows — nothing is estimated. */
export interface BacktestRunOverviewDTO {
  id: string;
  name: string;
  description: string | null;
  status: BacktestRunStatusValue;
  /** Frozen at run creation; `id` is null once the strategy is deleted. */
  strategy: { id: string | null; name: string; version: number | null } | null;
  strategyDrift: StrategyDriftState;
  assets: string[];
  startDateKey: string;
  endDateKey: string;
  tradingWeekdays: number[];
  progress: RunProgress;
  /** Where the trader last worked (visited) — NOT a completion marker. Null
   *  until the first session is opened. */
  currentPositionDateKey: string | null;
  /** Where "Continue" lands (see run-calendar.ts `resumeDateKey`). */
  resumeDateKey: string;
  lastActiveAt: string | null;
  /** Canonical, price-finalized figures (same engine as Backtesting Analytics). */
  stats: {
    /** Trades with an actual entry that weren't cancelled. */
    executedTrades: number;
    /** Executed trades with a final result — the sample behind netR/winRate. */
    closedTrades: number;
    /** Σ finalized R; null before the first closed trade. */
    netR: number | null;
    winRate: number | null;
    /** Valid setups recorded as missed. */
    missedTrades: number;
  };
  /** Optional simulation-only equity settings — never a trading account. */
  simulation: { startingBalance: number | null; riskPercentPerTrade: number | null; currency: string | null };
  createdAt: string;
  archivedAt: string | null;
}

/** Strategy option for the create dialog — Strategy Lab is the only source. */
export interface BacktestStrategyOptionDTO {
  id: string;
  name: string;
  version: number;
  applicableAssets: string[];
}
