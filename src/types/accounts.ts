export interface TradingAccountDTO {
  id: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE";
  name: string;
  status: "ACTIVE" | "PASSED" | "FAILED" | "SUSPENDED" | "CLOSED";
  notes: string | null;
  createdAt: string;
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
}
