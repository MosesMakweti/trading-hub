/**
 * Pure Prop Firms metric math — no Prisma types, plain numbers in/out, same
 * style as domain/accounts/derived.ts (null = "not computable", never a
 * fabricated 0% or Infinity). Used by both the Market Overview (summed
 * across every account in a category) and each Company card (summed across
 * one firm's accounts) — one set of formulas, two scopes.
 *
 * Formulas (spec-defined):
 *   Account ROI            = Net Trading PnL / Starting Balance × 100
 *   Net Prop Firm Profit   = Total Payouts Received − Total Costs
 *   Trader Investment ROI  = Net Prop Firm Profit / Total Costs × 100
 */

export type AccountStatusLike = "ACTIVE" | "PASSED" | "FAILED" | "BREACHED" | "FUNDED" | "ARCHIVED";
export type StageTypeLike =
  | "PHASE_1"
  | "PHASE_2"
  | "PHASE_3"
  | "VERIFICATION"
  | "MASTER_FUNDED"
  | "PAYOUT_ELIGIBLE"
  | "CUSTOM";
export type StageStatusLike =
  | "PENDING"
  | "ACTIVE"
  | "PASSED"
  | "FAILED"
  | "BREACHED"
  | "RESET"
  | "ABANDONED"
  | "ARCHIVED";

export function isFundedStageType(type: StageTypeLike): boolean {
  return type === "MASTER_FUNDED" || type === "PAYOUT_ELIGIBLE";
}

/** Total real, stored cost of an account — challenge fee net of any discount,
 *  plus reset/activation/other fees. Never null: missing fields count as 0. */
export function accountTotalCosts(account: {
  purchasePrice: number | null;
  discount: number | null;
  resetFees: number | null;
  activationFees: number | null;
  otherCosts: number | null;
}): number {
  const challengeFee = Math.max(0, (account.purchasePrice ?? 0) - (account.discount ?? 0));
  return challengeFee + (account.resetFees ?? 0) + (account.activationFees ?? 0) + (account.otherCosts ?? 0);
}

/** null when there's no starting balance to divide by — never a fabricated 0%. */
export function accountRoiPercent(netTradingPnl: number, startingBalance: number): number | null {
  if (!(startingBalance > 0)) return null;
  return (netTradingPnl / startingBalance) * 100;
}

export function netPropFirmProfit(totalPayoutsReceived: number, totalCosts: number): number {
  return totalPayoutsReceived - totalCosts;
}

/** null when there are no costs to divide by (e.g. every account still free/unpurchased) —
 *  the trader hasn't "invested" anything yet, so a % return is undefined, not 0 or Infinity. */
export function traderInvestmentRoiPercent(netPropFirmProfitValue: number, totalCosts: number): number | null {
  if (!(totalCosts > 0)) return null;
  return (netPropFirmProfitValue / totalCosts) * 100;
}

export function challengePassRatePercent(passedCount: number, resolvedCount: number): number | null {
  if (!(resolvedCount > 0)) return null;
  return (passedCount / resolvedCount) * 100;
}

export interface AccountRollupInput {
  status: AccountStatusLike;
  startingBalance: number;
  /** Manual snapshot (see PropFirmAccount.currentBalance) — null if never set. */
  currentBalance: number | null;
  purchasePrice: number | null;
  discount: number | null;
  resetFees: number | null;
  activationFees: number | null;
  otherCosts: number | null;
  /** Sum of this account's PAID payouts' netReceived (0 if none). */
  paidPayoutsTotal: number;
  /** This account's current stage type, if it has one (PENDING/ACTIVE stage). */
  currentStageType: StageTypeLike | null;
}

export interface AggregateMetrics {
  accountCount: number;
  activeAccountCount: number;
  activeChallengeCount: number;
  fundedCount: number;
  /** Active accounts whose (manually-tracked) current balance has dropped
   *  below their starting balance — a simple, honest proxy from real stored
   *  data, NOT a full rule-breach evaluation (that needs the live rule
   *  engine, Prompt 3). Labeled as such wherever it's shown in the UI. */
  atRiskCount: number;
  breachedCount: number;
  combinedCurrentBalance: number;
  netTradingPnl: number;
  totalCosts: number;
  totalPayoutsReceived: number;
  netPropFirmProfit: number;
  accountRoiPercent: number | null;
  traderInvestmentRoiPercent: number | null;
}

export function aggregateAccounts(accounts: AccountRollupInput[]): AggregateMetrics {
  let activeAccountCount = 0;
  let activeChallengeCount = 0;
  let fundedCount = 0;
  let atRiskCount = 0;
  let breachedCount = 0;
  let combinedCurrentBalance = 0;
  let netTradingPnl = 0;
  let totalCosts = 0;
  let totalPayoutsReceived = 0;
  let combinedStartingBalance = 0;

  for (const a of accounts) {
    const current = a.currentBalance ?? a.startingBalance;
    const pnl = current - a.startingBalance;
    const costs = accountTotalCosts(a);

    combinedCurrentBalance += current;
    netTradingPnl += pnl;
    totalCosts += costs;
    totalPayoutsReceived += a.paidPayoutsTotal;
    combinedStartingBalance += a.startingBalance;

    if (a.status === "ACTIVE") {
      activeAccountCount += 1;
      if (a.currentBalance != null && a.currentBalance < a.startingBalance) atRiskCount += 1;
      if (a.currentStageType && isFundedStageType(a.currentStageType)) fundedCount += 1;
      else activeChallengeCount += 1;
    }
    if (a.status === "FUNDED") fundedCount += 1;
    if (a.status === "BREACHED") breachedCount += 1;
  }

  const profit = netPropFirmProfit(totalPayoutsReceived, totalCosts);

  return {
    accountCount: accounts.length,
    activeAccountCount,
    activeChallengeCount,
    fundedCount,
    atRiskCount,
    breachedCount,
    combinedCurrentBalance,
    netTradingPnl,
    totalCosts,
    totalPayoutsReceived,
    netPropFirmProfit: profit,
    accountRoiPercent: accountRoiPercent(netTradingPnl, combinedStartingBalance),
    traderInvestmentRoiPercent: traderInvestmentRoiPercent(profit, totalCosts),
  };
}
