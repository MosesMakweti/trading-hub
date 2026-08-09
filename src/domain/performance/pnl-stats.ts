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

export interface Drawdown {
  amount: number; // largest peak-to-trough decline, in currency (≥ 0)
  percent: number; // largest peak-to-trough decline, as a % of the peak (≥ 0)
}

/**
 * Maximum drawdown over a running-balance series (peak-to-trough). Amount and
 * percent are each the maximum observed (they can occur at different troughs).
 */
export function maxDrawdown(balances: number[]): Drawdown {
  if (balances.length === 0) return { amount: 0, percent: 0 };
  let peak = balances[0];
  let amount = 0;
  let percent = 0;
  for (const balance of balances) {
    if (balance > peak) peak = balance;
    const declineAmount = peak - balance;
    if (declineAmount > amount) amount = declineAmount;
    const declinePercent = peak !== 0 ? (declineAmount / peak) * 100 : 0;
    if (declinePercent > percent) percent = declinePercent;
  }
  return { amount, percent };
}

/**
 * Recovery factor = net profit / max drawdown (magnitude). How many times the
 * worst drawdown the net profit covers. Null when there is no drawdown yet.
 */
export function recoveryFactor(netPnl: number, maxDrawdownAmount: number): number | null {
  if (maxDrawdownAmount <= 0) return null;
  return netPnl / maxDrawdownAmount;
}
