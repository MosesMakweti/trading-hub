export function computePropFirmRoi(
  purchaseCost: number | null,
  totalPayouts: number | null,
): number | null {
  if (purchaseCost == null || purchaseCost <= 0 || totalPayouts == null) return null;
  return ((totalPayouts - purchaseCost) / purchaseCost) * 100;
}

export interface BrokerageMetrics {
  netProfit: number | null;
  totalReturnPercent: number | null;
  currentEquityGrowthPercent: number | null;
}

/**
 * netProfit adds withdrawals back and subtracts deposits, since those are
 * capital flows unrelated to trading performance — only currentEquityGrowth
 * compares raw balances directly.
 */
export function computeBrokerageMetrics(input: {
  startingBalance: number | null;
  currentBalance: number;
  totalWithdrawals: number | null;
  totalDeposits: number | null;
}): BrokerageMetrics {
  const startingBalance = input.startingBalance;
  const totalWithdrawals = input.totalWithdrawals ?? 0;
  const totalDeposits = input.totalDeposits ?? 0;

  if (startingBalance == null || startingBalance <= 0) {
    return { netProfit: null, totalReturnPercent: null, currentEquityGrowthPercent: null };
  }

  const netProfit = input.currentBalance - startingBalance - totalDeposits + totalWithdrawals;
  const totalReturnPercent = (netProfit / startingBalance) * 100;
  const currentEquityGrowthPercent =
    ((input.currentBalance - startingBalance) / startingBalance) * 100;

  return { netProfit, totalReturnPercent, currentEquityGrowthPercent };
}
