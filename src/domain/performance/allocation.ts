export type RiskInputType = "PERCENT" | "AMOUNT";

/**
 * The Performance Account's risk is fixed at 1% per trade — this is the
 * app's long-standing "1R = 1%" convention (see rr.ts), and it's what every
 * other participating account's risk is scaled against as a reference
 * multiplier of 1.0.
 */
export const PERFORMANCE_ACCOUNT_RISK_PERCENT = 1;

/**
 * Normalizes a risk input to a percentage of the given account's balance,
 * so a $-amount risk and a %-risk can be compared on the same footing.
 * Returns 0 for a non-positive balance (avoids a division blowup rather
 * than producing Infinity/NaN in the trade form).
 */
export function effectiveRiskPercent(
  riskInputType: RiskInputType,
  riskValue: number,
  accountBalance: number,
): number {
  if (riskInputType === "PERCENT") return riskValue;
  if (accountBalance <= 0) return 0;
  return (riskValue / accountBalance) * 100;
}

/**
 * Scales the Performance Account's real dollar PnL to a participating
 * account's proportional result. Example: Performance Account risks 1% and
 * nets +$2,500 → an account risking 0.5% nets +$1,250 (half), an account
 * risking 2% nets +$5,000 (double). Losses scale the same way.
 */
export function scalePnlByRisk(performancePnl: number, accountRiskPercent: number): number {
  return performancePnl * (accountRiskPercent / PERFORMANCE_ACCOUNT_RISK_PERCENT);
}
