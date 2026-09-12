/**
 * Journal rebuild (Stage 9 §2) — the calendar's win/loss/breakeven/no-result
 * classification, driven by realized R (the primary trader-performance
 * number) rather than dollar PnL. Pure and framework-free; shared by the
 * month calendar (JournalDayButton/JournalWeekRow) and the year view.
 */
export type DayResultState = "WIN" | "LOSS" | "BREAKEVEN" | "NONE";

const EPSILON = 0.001;

export function deriveDayResultState(executedTradeCount: number, totalRealizedR: number): DayResultState {
  if (executedTradeCount <= 0) return "NONE";
  if (totalRealizedR > EPSILON) return "WIN";
  if (totalRealizedR < -EPSILON) return "LOSS";
  return "BREAKEVEN";
}
