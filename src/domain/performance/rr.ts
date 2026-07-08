/**
 * Two distinct numbers exist per trade and must not be conflated:
 *  1. Real per-account risk/PnL (dollars/percent the user enters per
 *     account) — used for real profitability in My Accounts.
 *  2. This normalized "1R = 1%" journal metric — used only for calendar
 *     badges and the equity curve, so trades can be compared/aggregated
 *     across accounts of different sizes without needing real balances.
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
