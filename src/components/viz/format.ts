// Pure number/date formatters for chart axes, tooltips and annotations.
// Plain module (no "use client") so Server Components can call them too.
// Signs use a true minus (U+2212) so +/− columns align and read cleanly.

const MINUS = "−";

function sign(n: number, { signed }: { signed: boolean }): string {
  if (n < 0) return MINUS;
  return signed && n > 0 ? "+" : "";
}

/** Normalises −0 and float noise so a value that rounds to zero prints as 0. */
function clean(n: number, digits: number): number {
  const r = Number(n.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
}

/** R-multiple: "+1.25R", "−0.50R", "0.00R". */
export function formatR(n: number | null | undefined, digits = 2, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = clean(n, digits);
  return `${sign(v, { signed })}${Math.abs(v).toFixed(digits)}R`;
}

/** Percent: "+3.2%", "−1.0%". */
export function formatPct(n: number | null | undefined, digits = 1, signed = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = clean(n, digits);
  return `${sign(v, { signed })}${Math.abs(v).toFixed(digits)}%`;
}

/** Money: "$12,480", "−$1,204", "+$350" (whole dollars by default). */
export function formatMoney(n: number | null | undefined, { signed = false, digits = 0 } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = clean(n, digits);
  const body = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign(v, { signed })}$${body}`;
}

/** Compact money for axis ticks: "$950", "$1.2k", "$12k", "$1.3M". */
export function formatMoneyCompact(n: number, { signed = false } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  let body: string;
  if (a >= 1_000_000) body = `${trim(a / 1_000_000, a >= 10_000_000 ? 0 : 1)}M`;
  else if (a >= 1_000) body = `${trim(a / 1_000, a >= 10_000 ? 0 : 1)}k`;
  else body = `${Math.round(a)}`;
  const s = Math.round(a) === 0 ? "" : sign(n, { signed });
  return `${s}$${body}`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.0$/, "");
}

/** Compact count: 950, 1.2k, 12k. */
export function formatCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${trim(n / 1_000_000, 1)}M`;
  if (a >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (a >= 1_000) return `${trim(n / 1_000, 1)}k`;
  return String(Math.round(n));
}

export type ValueUnit = "r" | "money" | "percent" | "count";

/** Full-precision value for tooltips / headlines in the given unit. */
export function formatValue(n: number | null | undefined, unit: ValueUnit, { signed = false } = {}): string {
  if (unit === "r") return formatR(n, 2, signed);
  if (unit === "money") return formatMoney(n, { signed });
  if (unit === "percent") return formatPct(n, 2, signed);
  return n == null ? "—" : formatCount(n);
}

/** Compact value for axis ticks in the given unit. */
export function formatTick(n: number, unit: ValueUnit): string {
  if (unit === "r") return `${clean(n, 1) === 0 ? "0" : trim(clean(n, 1), 1).replace("-", MINUS)}R`;
  if (unit === "money") return formatMoneyCompact(n);
  if (unit === "percent") return `${trim(clean(n, 1), 1).replace("-", MINUS)}%`;
  return formatCount(n);
}

// ── Dates (dateKey = "YYYY-MM-DD", calendar dates — formatted in UTC so a key
//    never shifts a day in a negative-offset timezone) ──────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(dateKey: string): { y: number; m: number; d: number; wd: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd };
}

/** Days between two dateKeys (b − a). */
export function daySpan(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Axis tick for a dateKey, granularity chosen by the visible span:
 *  ≤ ~4 months → "Sep 18", ≤ ~2 years → "Sep '26", longer → "2026". */
export function formatDateTick(dateKey: string, spanDays: number): string {
  const p = parts(dateKey);
  if (!p) return dateKey;
  if (spanDays <= 120) return `${MONTHS[p.m - 1]} ${p.d}`;
  if (spanDays <= 730) return `${MONTHS[p.m - 1]} '${String(p.y).slice(2)}`;
  return String(p.y);
}

/** Tooltip date: "Thu, Sep 18, 2026". */
export function formatDateLong(dateKey: string): string {
  const p = parts(dateKey);
  if (!p) return dateKey;
  return `${WEEKDAYS[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** Short range label: "Sep 2 – Oct 1, 2026" (year shown once when shared). */
export function formatDateRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} – ${to}`;
  const left = `${MONTHS[a.m - 1]} ${a.d}${a.y !== b.y ? `, ${a.y}` : ""}`;
  return `${left} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}
