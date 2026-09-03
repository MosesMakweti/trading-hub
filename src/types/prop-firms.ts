export interface DirectoryEntryDTO {
  id: string;
  companyName: string;
  slug: string;
  logoUrl: string | null;
  markets: ("CFD" | "FUTURES")[];
  website: string | null;
  accentColor: string | null;
}

export interface StageRuleDTO {
  id: string;
  name: string;
  ruleKey: string;
  valueType: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  textValue: string | null;
  measurementBasis: string | null;
  measurementPeriod: string | null;
  warningThreshold: number | null;
  breachThreshold: number | null;
  breachAction: string | null;
  description: string | null;
  isEnabled: boolean;
  sortOrder: number;
}

export interface MilestoneDTO {
  id: string;
  stageId: string | null;
  type: string;
  title: string | null;
  description: string | null;
  achievedAt: string;
  documents: MediaItemLikeDTO[];
}

export interface PayoutDTO {
  id: string;
  stageId: string | null;
  grossPayout: number;
  profitSplitPercent: number | null;
  netExpected: number | null;
  netReceived: number | null;
  /** What the trader actually received after the split — derived from this
   *  row's own immutable snapshot (netReceived, else gross × snapshot %, else
   *  gross). Never recomputed from the account's current rule. */
  traderReceived: number;
  /** The prop firm's share for this row. Null when no % was ever snapshotted. */
  propFirmShare: number | null;
  requestedDate: string | null;
  approvedDate: string | null;
  paidDate: string | null;
  status: string;
  paymentMethod: string | null;
  referenceId: string | null;
  feesDeductions: number | null;
  notes: string | null;
  /** Import provenance — null for a manually entered payout. */
  platformTransactionId: string | null;
  importBatchId: string | null;
  documents: MediaItemLikeDTO[];
}

/** Mirrors MediaItemDTO (media.service.ts) without importing the server module
 *  into client-shared types. */
export interface MediaItemLikeDTO {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  category: string | null;
  caption: string | null;
}

export interface AccountStageDTO {
  id: string;
  name: string;
  order: number;
  type: string;
  startingBalance: number;
  currentBalance: number | null;
  startDate: string | null;
  completionDate: string | null;
  status: string;
  profitLoss: number | null;
  completionNotes: string | null;
  rules: StageRuleDTO[];
}

export interface PropFirmAccountDTO {
  id: string;
  userPropFirmId: string;
  tradingAccountId: string | null;
  displayName: string;
  externalRef: string | null;
  marketCategory: "CFD" | "FUTURES";
  modelName: string | null;
  modelType: string;
  accountSize: number;
  accountCurrency: string;
  purchasePrice: number | null;
  discount: number | null;
  resetFees: number | null;
  activationFees: number | null;
  otherCosts: number | null;
  purchaseDate: string | null;
  status: string;
  startingBalance: number;
  currentBalance: number | null;
  currentEquity: number | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  stages: AccountStageDTO[];
  payouts: PayoutDTO[];
  milestones: MilestoneDTO[];
}

// ── Trade Idea Account Allocation / Execution (final phase) ─────────────────

export interface ExecutionDTO {
  id: string;
  tradeId: string;
  tradeDate: string;
  assetSymbol: string;
  direction: string;
  strategyName: string | null;
  entryModelName: string | null;
  propFirmAccountId: string;
  accountStageId: string;
  stageName: string;
  riskEntryMode: string;
  riskBasis: string;
  riskInputValue: number;
  /** The resolved risk base (balance/equity/stage-starting), frozen at the
   *  moment this allocation was first confirmed — see schema comment on
   *  TradeAccountExecution.riskBaseSnapshot. */
  riskBaseSnapshot: number;
  /** plannedRiskAmount / riskBaseSnapshot × 100 — always exact now that the
   *  base itself is snapshotted, regardless of riskEntryMode. */
  riskPercentOfBase: number | null;
  plannedRiskAmount: number;
  plannedPositionSize: number | null;
  positionSizeMissingReason: string | null;
  plannedR: number | null;
  actualEntry: number | null;
  actualExit: number | null;
  actualLotSize: number | null;
  actualContractQty: number | null;
  grossPnl: number | null;
  commission: number | null;
  swapFinancing: number | null;
  otherFees: number | null;
  netPnl: number | null;
  isPnlEstimated: boolean;
  actualR: number | null;
  status: string;
  executionNotes: string | null;
  closedAt: string | null;
  /** Ledger-derived; only populated on the account Trade Track Record (spec
   *  §6) — null on trade-idea-scoped executions. */
  balanceBefore: number | null;
  balanceAfter: number | null;
}

export interface AccountAllocationSelectorDTO {
  id: string;
  displayName: string;
  companyName: string;
  logoUrl: string | null;
  accentColor: string | null;
  marketCategory: "CFD" | "FUTURES";
  status: string;
  startingBalance: number;
  accountCurrency: string;
  currentStageName: string | null;
  currentStageId: string | null;
  currentStageType: string | null;
}

export interface RuleHealthDTO {
  ruleId: string;
  ruleName: string;
  ruleKey: string;
  state: string;
  percentConsumed: number | null;
  currentValue: number | null;
  limitValue: number | null;
  detail: string;
}

export interface LedgerEntryDTO {
  id: string;
  eventType: string;
  amount: number;
  balanceAfter: number;
  occurredAt: string;
  reason: string | null;
  stageId: string | null;
  /** Polymorphic source of a system-derived entry (e.g. "ACCOUNT_INIT",
   *  "TRADE_EXECUTION", "PAYOUT") — powers the balance-curve opening-entry
   *  detection and dedupe. Null for manual adjustments. */
  sourceType: string | null;
  sourceId: string | null;
}

export interface TrackRecordDTO {
  startingBalance: number;
  currentBalance: number;
  grossPnl: number;
  netPnl: number;
  roiPercent: number | null;
  totalParticipatingTrades: number;
  executedTrades: number;
  missedOrCancelledTrades: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePercent: number | null;
  avgR: number | null;
  totalR: number | null;
  avgRiskPercent: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number;
  profitFactor: number | null;
  maxRealizedDrawdown: number;
  currentDrawdown: number;
  feesPaid: number;
  payoutsReceived: number;
  netReturnAfterCosts: number;
  tradingDaysCompleted: number;
  lastActivityAt: string | null;
}

export interface ImportBatchDTO {
  id: string;
  platform: string;
  fileFormat: string;
  fileName: string;
  fileSizeBytes: number;
  sheetOrTableName: string | null;
  timezone: string;
  status: "CONFIRMED" | "ROLLED_BACK";
  dateRangeFrom: string | null;
  dateRangeTo: string | null;
  newExecutionsCount: number;
  newTradesCount: number;
  newPayoutsCount: number;
  skippedDuplicatesCount: number;
  rejectedRowsCount: number;
  warnings: { rowIndex: number | null; message: string }[] | null;
  createdAt: string;
  rolledBackAt: string | null;
}

export interface MappingTemplateDTO {
  id: string;
  name: string;
  platform: string;
  columnMapping: Record<string, string | undefined>;
  createdAt: string;
  updatedAt: string;
}

export interface UserPropFirmDTO {
  id: string;
  identityKind: "DIRECTORY" | "CUSTOM";
  directoryEntryId: string | null;
  companyName: string;
  logoUrl: string | null;
  website: string | null;
  accentColor: string | null;
  marketCategory: "CFD" | "FUTURES";
  isPriority: boolean;
  priorityOrder: number | null;
  status: "ACTIVE" | "ARCHIVED";
  notes: string | null;
  accounts: PropFirmAccountDTO[];
}
