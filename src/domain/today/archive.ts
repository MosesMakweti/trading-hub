export type DayStatus = "ACTIVE" | "ARCHIVED";

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
