export interface AccountTrackRecordEntryDTO {
  tradeId: string;
  dateKey: string;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  riskInputType: "PERCENT" | "AMOUNT";
  riskValue: number;
  pnl: number;
  runningBalance: number;
}

export interface TradingAccountDTO {
  id: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE";
  name: string;
  status: "ACTIVE" | "PASSED" | "FAILED" | "SUSPENDED" | "CLOSED";
  notes: string | null;
  createdAt: string;
  // Computed server-side (baseline + trade PnL history) — never a raw stored field.
  currentBalance: number;
  propFirmName: string | null;
  accountSize: number | null;
  phase: "PHASE_1" | "PHASE_2" | "MASTER" | null;
  purchaseCost: number | null;
  totalPayouts: number | null;
  brokerName: string | null;
  startingBalance: number | null;
  totalWithdrawals: number | null;
  totalDeposits: number | null;
  trackRecord: AccountTrackRecordEntryDTO[];
}

export interface PerformanceAccountDTO {
  id: string;
  name: string;
  startingBalance: number;
  currentBalance: number;
  netProfit: number;
  totalReturnPercent: number;
  trackRecord: AccountTrackRecordEntryDTO[];
}
