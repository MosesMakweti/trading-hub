export type DayStatus = "ACTIVE" | "ARCHIVED";

export type TradeReviewLifecycleStatusValue =
  | "FULLY_CLOSED"
  | "PARTIALLY_CLOSED"
  | "STILL_HOLDING"
  | "CANCELLED_NEVER_TRIGGERED"
  | null;

/**
 * A trading day is editable unless it has been archived. A `null` day means no
 * `TradingDay` row exists for that date (it was never opened in the Today
 * workspace), which is always editable — you can't have archived what you never
 * started. Archiving is reversible via reopen, so this only gates the current
 * state, never permanently locks anything.
 */
export function isDayEditable(day: { status: DayStatus } | null): boolean {
  return day == null || day.status !== "ARCHIVED";
}

/**
 * Journal rebuild (Stage 9 §15) — the UI-level mirror of
 * actions/day-guard.ts's tradeExecutionEditableGuard: a carried-open trade
 * (PARTIALLY_CLOSED / STILL_HOLDING) keeps its own execution/review fields
 * editable even after its Trading Day archives, narrowly — everything else
 * about the day (Daily Outlook, Asset Analysis, the frozen setup-validation
 * snapshot, the original day context) stays fully locked, since this only
 * ever affects the Trade Workspace's own `editable` prop, never the day's.
 * Once the trade becomes FULLY_CLOSED (or was CANCELLED_NEVER_TRIGGERED, or
 * never reviewed at all), the normal historical lock applies again.
 */
export function isTradeWorkspaceEditable(
  day: { status: DayStatus } | null,
  trade: { reviewLifecycleStatus: TradeReviewLifecycleStatusValue },
): boolean {
  if (isDayEditable(day)) return true;
  return trade.reviewLifecycleStatus === "PARTIALLY_CLOSED" || trade.reviewLifecycleStatus === "STILL_HOLDING";
}
