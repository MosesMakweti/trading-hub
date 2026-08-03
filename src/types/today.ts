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

/** Morning Preparation section data (P3). The routine template comes from the
 *  user's PRE_SESSION_ROUTINE checklist; per-day state lives on TradingDay. */
export interface MorningPrepDTO {
  routineItems: { id: string; label: string }[];
  completedIds: string[];
  marketContext: unknown; // Tiptap JSON or null
  readiness: number | null; // 1–5
  prepComplete: boolean;
}
