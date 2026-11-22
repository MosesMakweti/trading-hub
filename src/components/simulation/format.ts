/** Display formatting for simulation money and prices (values arrive as decimal strings). */

export function fmtMoney(value: string | number | null | undefined, currency = "USD", opts: { sign?: boolean } = {}): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  if (n < 0) return `-${s}`;
  return opts.sign && n > 0 ? `+${s}` : s;
}

export function fmtR(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function pnlTone(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n > 0) return "text-emerald-500";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

/** "2024-05-14T09:05" → "14 May 2024 09:05" */
export function fmtWallClock(value: string | null | undefined): string {
  if (!value) return "—";
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${day} ${month} ${y}${t ? ` ${t}` : ""}`;
}

export const CLOSE_REASON_LABEL: Record<string, string> = {
  STOP_LOSS: "Stop loss",
  TAKE_PROFIT: "Take profit",
  MANUAL: "Closed",
  PARTIAL: "Partial",
  LIQUIDATION: "Liquidated",
  MARKET: "Market",
  PENDING_TRIGGERED: "Pending",
};
