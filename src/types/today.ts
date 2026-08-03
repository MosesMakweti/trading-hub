export type TradingDayStatus = "ACTIVE" | "ARCHIVED";

/** The Today workspace's day record (TradeOS V2 backbone). */
export interface TradingDayDTO {
  id: string;
  dateKey: string;
  status: TradingDayStatus;
  prepCompletedAt: string | null; // ISO
  planCompletedAt: string | null;
  analyzedAt: string | null;
  archivedAt: string | null;
}
