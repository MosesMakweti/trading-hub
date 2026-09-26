/**
 * Journal period totals (week / month / year / run) — ONE pure aggregation
 * over per-day summaries, shared by the live Journal's week column and the
 * Backtesting Journal. Components render the result; they never re-sum.
 */
export interface DaySummaryLike {
  dateKey: string;
  executedTradeCount: number;
  totalRealizedR: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** Valid setups recorded as missed that day (optional for older callers). */
  missedCount?: number;
}

export interface PeriodSummary {
  trades: number;
  totalR: number;
  totalPnl: number;
  wins: number;
  losses: number;
  breakevens: number;
  missed: number;
  /** Days in the period with at least one executed trade. */
  tradingDays: number;
}

export function summarizePeriod(days: Iterable<DaySummaryLike>, include: (dateKey: string) => boolean = () => true): PeriodSummary {
  const total: PeriodSummary = { trades: 0, totalR: 0, totalPnl: 0, wins: 0, losses: 0, breakevens: 0, missed: 0, tradingDays: 0 };
  for (const d of days) {
    if (!include(d.dateKey)) continue;
    total.trades += d.executedTradeCount;
    total.totalR += d.totalRealizedR;
    total.totalPnl += d.totalPnl;
    total.wins += d.wins;
    total.losses += d.losses;
    total.breakevens += d.breakevens;
    total.missed += d.missedCount ?? 0;
    if (d.executedTradeCount > 0) total.tradingDays += 1;
  }
  return total;
}
