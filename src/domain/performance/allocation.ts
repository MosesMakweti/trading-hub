export type RiskInputType = "PERCENT" | "AMOUNT";

/**
 * Normalizes a risk input to a percentage of the given account's balance,
 * so a $-amount risk and a %-risk can be compared on the same footing.
 * Returns 0 for a non-positive balance (avoids a division blowup rather
 * than producing Infinity/NaN in the trade form). Used to validate a
 * Performance Account risk override against its configured maximum (spec
 * §5), and by real accounts entering a $-risk instead of a %.
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
