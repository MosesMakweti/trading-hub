/**
 * `actualRR` is a self-reported R-multiple the trader records per trade —
 * useful as a journal/discipline metric, but no longer what analytics is
 * built from. Every dashboard number now derives from the Performance
 * Account's real dollar PnL (the app's single source of truth — see
 * accounts.service.ts / analytics.service.ts), converted to daily % returns
 * via `dailyPercentsFromBalanceHistory` below and fed through the same
 * `buildEquityCurve` pipeline either way.
 */

export type CalendarColor = "green" | "red" | "gray";

/** Open trades (`actualRR` not yet set) contribute 0 and are excluded from closed-trade stats. */
export function tradeContributionPercent(actualRR: number | null): number {
  return actualRR ?? 0;
}

export function dailyPercentFromTrades(trades: { actualRR: number | null }[]): number {
  return trades.reduce((sum, t) => sum + tradeContributionPercent(t.actualRR), 0);
}

/**
 * Order-independent and history-independent by design: a calendar cell
 * represents "what happened that day," full stop — it shouldn't shift if
 * past data changes or if intraday trade order is ambiguous.
 */
export function calendarColorForPercent(percent: number, tradeCount: number): CalendarColor {
  if (tradeCount === 0) return "gray";
  if (percent > 0) return "green";
  if (percent < 0) return "red";
  return "gray";
}

export interface EquityCurvePoint {
  dateKey: string;
  cumulativeCompounding: number;
  cumulativeAdditive: number;
}

/**
 * Daily-level compounding (`equity_d = equity_(d-1) * (1 + pct/100)`) is the
 * default/recommended curve, since "1% risk per trade" is a fixed-fractional
 * assumption that mathematically compounds over time. `cumulativeAdditive`
 * (flat sum, no compounding) is offered alongside it for users who prefer
 * flat R-multiple tracking — both are derived from the same input series,
 * so there is only one source of truth with two presentation modes.
 */
export function buildEquityCurve(
  dailyPercents: { dateKey: string; percent: number }[],
): EquityCurvePoint[] {
  const sorted = [...dailyPercents].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  let equity = 100;
  let additive = 0;
  return sorted.map(({ dateKey, percent }) => {
    equity = equity * (1 + percent / 100);
    additive += percent;
    return {
      dateKey,
      cumulativeCompounding: (equity / 100 - 1) * 100,
      cumulativeAdditive: additive,
    };
  });
}

/**
 * Bridges real dollar PnL history into `buildEquityCurve`'s daily-percent
 * input: each day's return is its PnL relative to the balance at the start
 * of that day, so real accounting (the Performance Account) and the
 * abstract "1% per R" convention both compound through the same pipeline.
 */
export function dailyPercentsFromBalanceHistory(
  startingBalance: number,
  dailyPnl: { dateKey: string; pnl: number }[],
): { dateKey: string; percent: number }[] {
  const sorted = [...dailyPnl].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  let balance = startingBalance;
  return sorted.map(({ dateKey, pnl }) => {
    const percent = balance !== 0 ? (pnl / balance) * 100 : 0;
    balance += pnl;
    return { dateKey, percent };
  });
}
