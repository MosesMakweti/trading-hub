/**
 * Dollar-denominated performance stats + drawdown, derived from the Performance
 * Account's realized P&L (the same source `getAnalyticsData` already walks — no
 * duplicate data). Pure + unit-tested so the Analytics module can reuse them.
 */

export interface PnlStats {
  netPnl: number; // Σ pnl
  grossProfit: number; // Σ winning pnl (≥ 0)
  grossLoss: number; // Σ losing pnl (≤ 0)
  largestWin: number; // max single-trade pnl (0 if none positive)
  largestLoss: number; // min single-trade pnl (0 if none negative)
  breakevenTrades: number; // pnl exactly 0
}

export function pnlStats(pnls: number[]): PnlStats {
  let netPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let breakevenTrades = 0;

  for (const pnl of pnls) {
    netPnl += pnl;
    if (pnl > 0) {
      grossProfit += pnl;
      if (pnl > largestWin) largestWin = pnl;
    } else if (pnl < 0) {
      grossLoss += pnl;
      if (pnl < largestLoss) largestLoss = pnl;
    } else {
      breakevenTrades += 1;
    }
  }

  return { netPnl, grossProfit, grossLoss, largestWin, largestLoss, breakevenTrades };
}

export interface DrawdownPoint {
  /** Index into the input `balances` array (the caller zips this with its
   *  own per-point dates/trade ids — this module stays date-agnostic). */
  index: number;
  balance: number;
  peak: number;
  amount: number; // decline from the running peak AT this point (≥ 0)
  percent: number; // decline from the running peak AT this point, as % (≥ 0)
}

export interface Drawdown {
  amount: number; // largest peak-to-trough decline, in currency (≥ 0)
  percent: number; // largest peak-to-trough decline, as a % of the peak (≥ 0)
  /** Analytics V2 §5 — decline from the all-time peak AS OF the last point
   *  in the series (i.e. right now), not the historical maximum. Zero when
   *  the series is currently at its peak. */
  currentAmount: number;
  currentPercent: number;
  /** Analytics V2 §5 — the full drawdown-through-time series, one point per
   *  input balance, for visualization (never just the single worst number). */
  series: DrawdownPoint[];
}

/**
 * Maximum drawdown over a running-balance series (peak-to-trough). Amount and
 * percent are each the maximum observed (they can occur at different troughs).
 */
export function maxDrawdown(balances: number[]): Drawdown {
  if (balances.length === 0) return { amount: 0, percent: 0, currentAmount: 0, currentPercent: 0, series: [] };
  let peak = balances[0];
  let amount = 0;
  let percent = 0;
  const series: DrawdownPoint[] = [];
  for (let index = 0; index < balances.length; index++) {
    const balance = balances[index];
    if (balance > peak) peak = balance;
    const declineAmount = peak - balance;
    if (declineAmount > amount) amount = declineAmount;
    const declinePercent = peak !== 0 ? (declineAmount / peak) * 100 : 0;
    if (declinePercent > percent) percent = declinePercent;
    series.push({ index, balance, peak, amount: declineAmount, percent: declinePercent });
  }
  const current = series[series.length - 1];
  return { amount, percent, currentAmount: current.amount, currentPercent: current.percent, series };
}

/**
 * Recovery factor = net profit / max drawdown (magnitude). How many times the
 * worst drawdown the net profit covers. Null when there is no drawdown yet.
 */
export function recoveryFactor(netPnl: number, maxDrawdownAmount: number): number | null {
  if (maxDrawdownAmount <= 0) return null;
  return netPnl / maxDrawdownAmount;
}
