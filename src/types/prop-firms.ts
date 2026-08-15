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
  requestedDate: string | null;
  approvedDate: string | null;
  paidDate: string | null;
  status: string;
  paymentMethod: string | null;
  referenceId: string | null;
  feesDeductions: number | null;
  notes: string | null;
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
  platform: string | null;
  dataFeed: string | null;
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
  propFirmAccountId: string;
  accountStageId: string;
  stageName: string;
  riskEntryMode: string;
  riskBasis: string;
  riskInputValue: number;
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
}

export interface TrackRecordDTO {
  startingBalance: number;
  currentBalance: number;
  grossPnl: number;
  netPnl: number;
  roiPercent: number | null;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePercent: number | null;
  avgR: number | null;
  avgRiskPercent: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  profitFactor: number | null;
  maxRealizedDrawdown: number;
  currentDrawdown: number;
  feesPaid: number;
  payoutsReceived: number;
  netReturnAfterCosts: number;
  tradingDaysCompleted: number;
  lastActivityAt: string | null;
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
