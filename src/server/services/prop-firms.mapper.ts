import type {
  AccountStageWithRules,
  PropFirmAccountWithRelations,
  UserPropFirmWithRelations,
} from "@/server/services/prop-firms.service";
import type { MediaItemDTO } from "@/server/services/media.service";
import type { RuleEvaluationResult } from "@/domain/prop-firms/rule-health";
import type { TrackRecordSummary } from "@/domain/prop-firms/track-record";
import type {
  AccountAllocationSelectorDTO,
  AccountStageDTO,
  ExecutionDTO,
  LedgerEntryDTO,
  MediaItemLikeDTO,
  MilestoneDTO,
  PayoutDTO,
  PropFirmAccountDTO,
  RuleHealthDTO,
  StageRuleDTO,
  TrackRecordDTO,
  UserPropFirmDTO,
} from "@/types/prop-firms";

/** Both AccountMilestone and Payout rows are valid PROP_FIRM_MILESTONE
 *  owners — this map is keyed by owner id (milestone id OR payout id)
 *  regardless of which kind it is, exactly matching how listMediaForOwners
 *  groups its results. Empty map when the caller doesn't need documents
 *  (e.g. list views that only show counts). */
export type MediaByOwnerId = Map<string, MediaItemDTO[]>;

function toMediaLikeList(ownerId: string, mediaByOwnerId: MediaByOwnerId): MediaItemLikeDTO[] {
  return (mediaByOwnerId.get(ownerId) ?? []).map((m) => ({
    id: m.id,
    url: m.url,
    fileName: m.fileName,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    category: m.category,
    caption: m.caption,
  }));
}

function toStageRuleDTO(rule: AccountStageWithRules["rules"][number]): StageRuleDTO {
  return {
    id: rule.id,
    name: rule.name,
    ruleKey: rule.ruleKey,
    valueType: rule.valueType,
    numericValue: rule.numericValue?.toNumber() ?? null,
    booleanValue: rule.booleanValue,
    textValue: rule.textValue,
    measurementBasis: rule.measurementBasis,
    measurementPeriod: rule.measurementPeriod,
    warningThreshold: rule.warningThreshold?.toNumber() ?? null,
    breachThreshold: rule.breachThreshold?.toNumber() ?? null,
    breachAction: rule.breachAction,
    description: rule.description,
    isEnabled: rule.isEnabled,
    sortOrder: rule.sortOrder,
  };
}

function toStageDTO(stage: AccountStageWithRules): AccountStageDTO {
  return {
    id: stage.id,
    name: stage.name,
    order: stage.order,
    type: stage.type,
    startingBalance: stage.startingBalance.toNumber(),
    currentBalance: stage.currentBalance?.toNumber() ?? null,
    startDate: stage.startDate?.toISOString() ?? null,
    completionDate: stage.completionDate?.toISOString() ?? null,
    status: stage.status,
    profitLoss: stage.profitLoss?.toNumber() ?? null,
    completionNotes: stage.completionNotes,
    rules: stage.rules.map(toStageRuleDTO),
  };
}

function toMilestoneDTO(
  milestone: PropFirmAccountWithRelations["milestones"][number],
  mediaByOwnerId: MediaByOwnerId,
): MilestoneDTO {
  return {
    id: milestone.id,
    stageId: milestone.stageId,
    type: milestone.type,
    title: milestone.title,
    description: milestone.description,
    achievedAt: milestone.achievedAt.toISOString(),
    documents: toMediaLikeList(milestone.id, mediaByOwnerId),
  };
}

function toPayoutDTO(
  payout: PropFirmAccountWithRelations["payouts"][number],
  mediaByOwnerId: MediaByOwnerId,
): PayoutDTO {
  return {
    id: payout.id,
    stageId: payout.stageId,
    grossPayout: payout.grossPayout.toNumber(),
    profitSplitPercent: payout.profitSplitPercent?.toNumber() ?? null,
    netExpected: payout.netExpected?.toNumber() ?? null,
    netReceived: payout.netReceived?.toNumber() ?? null,
    requestedDate: payout.requestedDate?.toISOString() ?? null,
    approvedDate: payout.approvedDate?.toISOString() ?? null,
    paidDate: payout.paidDate?.toISOString() ?? null,
    status: payout.status,
    paymentMethod: payout.paymentMethod,
    referenceId: payout.referenceId,
    feesDeductions: payout.feesDeductions?.toNumber() ?? null,
    notes: payout.notes,
    documents: toMediaLikeList(payout.id, mediaByOwnerId),
  };
}

export function toPropFirmAccountDTO(
  account: PropFirmAccountWithRelations,
  mediaByOwnerId: MediaByOwnerId = new Map(),
  ledgerBalanceByAccountId: Map<string, { toNumber(): number }> = new Map(),
): PropFirmAccountDTO {
  // currentBalance is ledger-derived when the ledger has history for this
  // account (every account does, post-backfill/migration) — falls back to
  // the stored manual value only when it genuinely doesn't (defensive, not
  // expected in steady state). Mirrors TradingAccount.currentBalance's
  // existing "always computed, never trusted as stored" convention.
  const ledgerBalance = ledgerBalanceByAccountId.get(account.id);
  return {
    id: account.id,
    userPropFirmId: account.userPropFirmId,
    tradingAccountId: account.tradingAccountId,
    displayName: account.displayName,
    externalRef: account.externalRef,
    marketCategory: account.marketCategory,
    modelName: account.modelName,
    modelType: account.modelType,
    accountSize: account.accountSize.toNumber(),
    accountCurrency: account.accountCurrency,
    purchasePrice: account.purchasePrice?.toNumber() ?? null,
    discount: account.discount?.toNumber() ?? null,
    resetFees: account.resetFees?.toNumber() ?? null,
    activationFees: account.activationFees?.toNumber() ?? null,
    otherCosts: account.otherCosts?.toNumber() ?? null,
    purchaseDate: account.purchaseDate?.toISOString() ?? null,
    status: account.status,
    startingBalance: account.startingBalance.toNumber(),
    currentBalance: ledgerBalance ? ledgerBalance.toNumber() : (account.currentBalance?.toNumber() ?? null),
    currentEquity: account.currentEquity?.toNumber() ?? null,
    platform: account.platform,
    dataFeed: account.dataFeed,
    notes: account.notes,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    stages: account.stages.map(toStageDTO),
    payouts: account.payouts.map((p) => toPayoutDTO(p, mediaByOwnerId)),
    milestones: account.milestones.map((m) => toMilestoneDTO(m, mediaByOwnerId)),
  };
}

export function toUserPropFirmDTO(
  firm: UserPropFirmWithRelations,
  mediaByOwnerId: MediaByOwnerId = new Map(),
  ledgerBalanceByAccountId: Map<string, { toNumber(): number }> = new Map(),
): UserPropFirmDTO {
  return {
    id: firm.id,
    identityKind: firm.identityKind,
    directoryEntryId: firm.directoryEntryId,
    companyName: firm.directoryEntry?.companyName ?? firm.customCompanyName ?? "Unnamed firm",
    logoUrl: firm.directoryEntry?.logoUrl ?? firm.customLogoUrl,
    website: firm.directoryEntry?.website ?? firm.customWebsite,
    accentColor: firm.directoryEntry?.accentColor ?? firm.customAccentColor,
    marketCategory: firm.marketCategory,
    isPriority: firm.isPriority,
    priorityOrder: firm.priorityOrder,
    status: firm.status,
    notes: firm.notes,
    accounts: firm.accounts.map((a) => toPropFirmAccountDTO(a, mediaByOwnerId, ledgerBalanceByAccountId)),
  };
}

// ── Trade Idea Account Allocation / Execution (final phase) ─────────────────

type ExecutionRow = {
  id: string;
  tradeId: string;
  propFirmAccountId: string;
  accountStageId: string;
  riskEntryMode: string;
  riskBasis: string;
  riskInputValue: { toNumber(): number };
  plannedRiskAmount: { toNumber(): number };
  plannedPositionSize: { toNumber(): number } | null;
  positionSizeMissingReason: string | null;
  plannedR: { toNumber(): number } | null;
  actualEntry: { toNumber(): number } | null;
  actualExit: { toNumber(): number } | null;
  actualLotSize: { toNumber(): number } | null;
  actualContractQty: { toNumber(): number } | null;
  grossPnl: { toNumber(): number } | null;
  commission: { toNumber(): number } | null;
  swapFinancing: { toNumber(): number } | null;
  otherFees: { toNumber(): number } | null;
  netPnl: { toNumber(): number } | null;
  isPnlEstimated: boolean;
  actualR: { toNumber(): number } | null;
  status: string;
  executionNotes: string | null;
  closedAt: Date | null;
  trade: { id: string; tradeDate: Date; assetSymbol: string; direction: string };
  accountStage: { name: string };
};

export function toExecutionDTO(row: ExecutionRow): ExecutionDTO {
  return {
    id: row.id,
    tradeId: row.trade.id,
    tradeDate: row.trade.tradeDate.toISOString().slice(0, 10),
    assetSymbol: row.trade.assetSymbol,
    direction: row.trade.direction,
    propFirmAccountId: row.propFirmAccountId,
    accountStageId: row.accountStageId,
    stageName: row.accountStage.name,
    riskEntryMode: row.riskEntryMode,
    riskBasis: row.riskBasis,
    riskInputValue: row.riskInputValue.toNumber(),
    plannedRiskAmount: row.plannedRiskAmount.toNumber(),
    plannedPositionSize: row.plannedPositionSize?.toNumber() ?? null,
    positionSizeMissingReason: row.positionSizeMissingReason,
    plannedR: row.plannedR?.toNumber() ?? null,
    actualEntry: row.actualEntry?.toNumber() ?? null,
    actualExit: row.actualExit?.toNumber() ?? null,
    actualLotSize: row.actualLotSize?.toNumber() ?? null,
    actualContractQty: row.actualContractQty?.toNumber() ?? null,
    grossPnl: row.grossPnl?.toNumber() ?? null,
    commission: row.commission?.toNumber() ?? null,
    swapFinancing: row.swapFinancing?.toNumber() ?? null,
    otherFees: row.otherFees?.toNumber() ?? null,
    netPnl: row.netPnl?.toNumber() ?? null,
    isPnlEstimated: row.isPnlEstimated,
    actualR: row.actualR?.toNumber() ?? null,
    status: row.status,
    executionNotes: row.executionNotes,
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

type SelectorAccountRow = {
  id: string;
  displayName: string;
  marketCategory: "CFD" | "FUTURES";
  status: string;
  startingBalance: { toNumber(): number };
  userPropFirm: {
    customCompanyName: string | null;
    customLogoUrl: string | null;
    customAccentColor: string | null;
    directoryEntry: { companyName: string; logoUrl: string | null; accentColor: string | null } | null;
  };
  stages: { id: string; name: string; type: string }[];
};

export function toAccountAllocationSelectorDTO(row: SelectorAccountRow): AccountAllocationSelectorDTO {
  const currentStage = row.stages[0] ?? null;
  return {
    id: row.id,
    displayName: row.displayName,
    companyName: row.userPropFirm.directoryEntry?.companyName ?? row.userPropFirm.customCompanyName ?? "Unnamed firm",
    logoUrl: row.userPropFirm.directoryEntry?.logoUrl ?? row.userPropFirm.customLogoUrl,
    accentColor: row.userPropFirm.directoryEntry?.accentColor ?? row.userPropFirm.customAccentColor,
    marketCategory: row.marketCategory,
    status: row.status,
    startingBalance: row.startingBalance.toNumber(),
    currentStageName: currentStage?.name ?? null,
    currentStageId: currentStage?.id ?? null,
    currentStageType: currentStage?.type ?? null,
  };
}

export function toRuleHealthDTO(result: RuleEvaluationResult, ruleName: string, ruleKey: string): RuleHealthDTO {
  return {
    ruleId: result.ruleId,
    ruleName,
    ruleKey,
    state: result.state,
    percentConsumed: result.percentConsumed,
    currentValue: result.currentValue?.toNumber() ?? null,
    limitValue: result.limitValue?.toNumber() ?? null,
    detail: result.detail,
  };
}

type LedgerEntryRow = {
  id: string;
  eventType: string;
  amount: { toNumber(): number };
  balanceAfter: { toNumber(): number };
  occurredAt: Date;
  reason: string | null;
  stageId: string | null;
};

export function toLedgerEntryDTO(entry: LedgerEntryRow): LedgerEntryDTO {
  return {
    id: entry.id,
    eventType: entry.eventType,
    amount: entry.amount.toNumber(),
    balanceAfter: entry.balanceAfter.toNumber(),
    occurredAt: entry.occurredAt.toISOString(),
    reason: entry.reason,
    stageId: entry.stageId,
  };
}

export function toTrackRecordDTO(summary: TrackRecordSummary): TrackRecordDTO {
  return {
    startingBalance: summary.startingBalance.toNumber(),
    currentBalance: summary.currentBalance.toNumber(),
    grossPnl: summary.grossPnl.toNumber(),
    netPnl: summary.netPnl.toNumber(),
    roiPercent: summary.roiPercent,
    totalTrades: summary.totalTrades,
    wins: summary.wins,
    losses: summary.losses,
    breakeven: summary.breakeven,
    winRatePercent: summary.winRatePercent,
    avgR: summary.avgR,
    avgRiskPercent: summary.avgRiskPercent,
    largestWin: summary.largestWin?.toNumber() ?? null,
    largestLoss: summary.largestLoss?.toNumber() ?? null,
    longestWinStreak: summary.longestWinStreak,
    longestLossStreak: summary.longestLossStreak,
    profitFactor: summary.profitFactor,
    maxRealizedDrawdown: summary.maxRealizedDrawdown.toNumber(),
    currentDrawdown: summary.currentDrawdown.toNumber(),
    feesPaid: summary.feesPaid.toNumber(),
    payoutsReceived: summary.payoutsReceived.toNumber(),
    netReturnAfterCosts: summary.netReturnAfterCosts.toNumber(),
    tradingDaysCompleted: summary.tradingDaysCompleted,
    lastActivityAt: summary.lastActivityAt?.toISOString() ?? null,
  };
}

/** Every milestone + payout id across a set of firms/accounts — feed this to
 *  listMediaForOwners once, then pass the result into the DTO mappers above. */
export function collectEvidenceOwnerIds(firms: UserPropFirmWithRelations[]): string[] {
  const ids: string[] = [];
  for (const firm of firms) {
    for (const account of firm.accounts) {
      for (const m of account.milestones) ids.push(m.id);
      for (const p of account.payouts) ids.push(p.id);
    }
  }
  return ids;
}

/** Every account id across a set of firms — feed this to
 *  getLedgerDerivedBalances once, then pass the result into toUserPropFirmDTO/
 *  toPropFirmAccountDTO so currentBalance reads from the ledger. */
export function collectAccountIds(firms: UserPropFirmWithRelations[]): string[] {
  return firms.flatMap((firm) => firm.accounts.map((a) => a.id));
}
