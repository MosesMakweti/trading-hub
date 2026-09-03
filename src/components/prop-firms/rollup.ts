import type { AccountRollupInput } from "@/domain/prop-firms/metrics";
import type { PropFirmAccountDTO } from "@/types/prop-firms";

/** Adapts the DTO shape (as fetched for the UI) into the pure domain
 *  metrics module's input shape — kept separate from the domain module
 *  itself so that module stays framework/DTO-agnostic. */
export function toAccountRollupInput(account: PropFirmAccountDTO): AccountRollupInput {
  const currentStage = account.stages.find((s) => s.status === "ACTIVE") ?? null;
  const paidPayoutsTotal = account.payouts
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + (p.netReceived ?? p.grossPayout), 0);

  return {
    status: account.status as AccountRollupInput["status"],
    startingBalance: account.startingBalance,
    currentBalance: account.currentBalance,
    purchasePrice: account.purchasePrice,
    discount: account.discount,
    resetFees: account.resetFees,
    activationFees: account.activationFees,
    otherCosts: account.otherCosts,
    paidPayoutsTotal,
    currentStageType: (currentStage?.type as AccountRollupInput["currentStageType"]) ?? null,
  };
}
