import { dateKeyToUtcDate } from "@/lib/date";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt(key: string, options: Intl.DateTimeFormatOptions, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(dateKeyToUtcDate(key));
}

/** "Jan 1 – Jun 30, 2024", or "Dec 4, 2023 – Jan 19, 2024" across years. */
export function formatRunPeriod(startKey: string, endKey: string): string {
  const sameYear = startKey.slice(0, 4) === endKey.slice(0, 4);
  const start = fmt(startKey, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${start} – ${fmt(endKey, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** "14 May 2024" — the simulation-date style used across Backtesting. */
export function formatSimDate(key: string): string {
  return fmt(key, { day: "numeric", month: "short", year: "numeric" }, "en-GB");
}

/** "Tuesday" */
export function formatSimWeekday(key: string): string {
  return fmt(key, { weekday: "long" });
}

/** "Mon 13 May" — compact label for previous/next controls. */
export function formatSimDateCompact(key: string): string {
  return fmt(key, { weekday: "short", day: "numeric", month: "short" }, "en-GB");
}

/** "Mon–Fri", "Sun–Fri", or an explicit list for irregular sets. */
export function formatWeekdays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length >= 3 && contiguous) return `${WEEKDAY_SHORT[sorted[0]]}–${WEEKDAY_SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

export function formatSimulationBalance(amount: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
      // unknown ISO code — fall through to a plain figure
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}

export const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: WEEKDAY_SHORT[d] }));
