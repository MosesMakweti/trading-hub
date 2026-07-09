export interface TradeMetricInput {
  dateKey: string;
  assetSymbol: string;
  actualRR: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function closedTrades(trades: TradeMetricInput[]): (TradeMetricInput & { actualRR: number })[] {
  return trades.filter((t): t is TradeMetricInput & { actualRR: number } => t.actualRR !== null);
}

export function winRate(trades: TradeMetricInput[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  return (closed.filter((t) => t.actualRR > 0).length / closed.length) * 100;
}

export function averageRR(trades: TradeMetricInput[]): number | null {
  return average(closedTrades(trades).map((t) => t.actualRR));
}

export function averageWinner(trades: TradeMetricInput[]): number | null {
  return average(closedTrades(trades).filter((t) => t.actualRR > 0).map((t) => t.actualRR));
}

export function averageLoser(trades: TradeMetricInput[]): number | null {
  return average(closedTrades(trades).filter((t) => t.actualRR < 0).map((t) => t.actualRR));
}

/** Gross winning R / gross losing R (magnitude). Null when there are no losses (undefined ratio). */
export function profitFactor(trades: TradeMetricInput[]): number | null {
  const closed = closedTrades(trades);
  const grossWin = closed.filter((t) => t.actualRR > 0).reduce((s, t) => s + t.actualRR, 0);
  const grossLoss = Math.abs(closed.filter((t) => t.actualRR < 0).reduce((s, t) => s + t.actualRR, 0));
  if (grossLoss === 0) return null;
  return grossWin / grossLoss;
}

/**
 * Textbook expectancy: (win% × avg winner) + (loss% × avg loser). In R-multiple
 * terms this is mathematically identical to `averageRR` — kept as a separate,
 * explicit computation because it's a distinct, commonly-cited metric name,
 * and the equivalence is exactly what the test suite cross-checks.
 */
export function expectancy(trades: TradeMetricInput[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => t.actualRR > 0);
  const losses = closed.filter((t) => t.actualRR < 0);
  const winPct = wins.length / closed.length;
  const lossPct = losses.length / closed.length;
  const avgWin = average(wins.map((t) => t.actualRR)) ?? 0;
  const avgLoss = average(losses.map((t) => t.actualRR)) ?? 0;
  return winPct * avgWin + lossPct * avgLoss;
}

function longestStreak(trades: TradeMetricInput[], isMatch: (rr: number) => boolean): number {
  const closed = [...closedTrades(trades)].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  let longest = 0;
  let current = 0;
  for (const t of closed) {
    if (isMatch(t.actualRR)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function longestWinStreak(trades: TradeMetricInput[]): number {
  return longestStreak(trades, (rr) => rr > 0);
}

export function longestLossStreak(trades: TradeMetricInput[]): number {
  return longestStreak(trades, (rr) => rr < 0);
}

export function mostTradedAsset(trades: TradeMetricInput[]): { assetSymbol: string; count: number } | null {
  if (trades.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.assetSymbol, (counts.get(t.assetSymbol) ?? 0) + 1);
  const [assetSymbol, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { assetSymbol, count };
}

export function averageTradesPerDay(trades: TradeMetricInput[], rangeDays: number): number {
  if (rangeDays <= 0) return 0;
  return trades.length / rangeDays;
}

export interface AssetStats {
  assetSymbol: string;
  totalTrades: number;
  winRate: number | null;
  averageRR: number | null;
  totalReturnPercent: number;
}

/** Per-asset breakdown, sorted by total return descending — first entry is "best performing asset." */
export function statsByAsset(trades: TradeMetricInput[]): AssetStats[] {
  const byAsset = new Map<string, TradeMetricInput[]>();
  for (const t of trades) {
    const list = byAsset.get(t.assetSymbol) ?? [];
    list.push(t);
    byAsset.set(t.assetSymbol, list);
  }

  return [...byAsset.entries()]
    .map(([assetSymbol, assetTrades]) => ({
      assetSymbol,
      totalTrades: assetTrades.length,
      winRate: winRate(assetTrades),
      averageRR: averageRR(assetTrades),
      totalReturnPercent: closedTrades(assetTrades).reduce((sum, t) => sum + t.actualRR, 0),
    }))
    .sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);
}

/** Groups a `{dateKey, percent}` series (e.g. from `buildEquityCurve`'s inputs) into monthly sums. */
export function monthlyReturns(
  dailyPercents: { dateKey: string; percent: number }[],
): { month: string; percent: number }[] {
  const byMonth = new Map<string, number>();
  for (const d of dailyPercents) {
    const month = d.dateKey.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + d.percent);
  }
  return [...byMonth.entries()]
    .map(([month, percent]) => ({ month, percent }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
