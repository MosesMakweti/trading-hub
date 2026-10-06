import { localDateToKey } from "@/lib/date";

export type DateRangePreset = "week" | "month" | "3months" | "year" | "ytd" | "all" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  week: "7D",
  month: "30D",
  "3months": "90D",
  year: "1Y",
  ytd: "YTD",
  all: "ALL",
  custom: "Custom Range",
};

// Analytics V2 §18 — "ALL" has no natural lower bound; getAnalyticsData/
// getCanonicalAnalyticsDataset both take concrete from/to strings (the
// canonical dataset alone supports omitting them, but the shared date-range
// UI needs one answer for both pipelines), so this sentinel stands in for
// "since the beginning" without a schema change or a second range shape.
export const ALL_TIME_FROM = "2000-01-01";

/** Preset → range on the BROWSER/SERVER-LOCAL calendar of `today`. Server
 *  pages must use `presetToRangeForKey` with the trader's today key instead
 *  (trader-time.service.ts) — the server's own calendar is UTC. */
export function presetToRange(
  preset: Exclude<DateRangePreset, "custom">,
  today: Date = new Date(),
): DateRange {
  return presetToRangeForKey(preset, localDateToKey(today));
}

/** Preset → range ending on `todayKey` (pure calendar arithmetic on date
 *  keys — no timezone involved, so the trader's calendar decides "today"). */
export function presetToRangeForKey(preset: Exclude<DateRangePreset, "custom">, todayKey: string): DateRange {
  const to = todayKey;
  if (preset === "all") return { from: ALL_TIME_FROM, to };
  const [y, m, d] = todayKey.split("-").map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d));
  switch (preset) {
    case "week":
      fromDate.setUTCDate(fromDate.getUTCDate() - 6);
      break;
    case "month":
      fromDate.setUTCMonth(fromDate.getUTCMonth() - 1);
      break;
    case "3months":
      fromDate.setUTCMonth(fromDate.getUTCMonth() - 3);
      break;
    case "year":
      fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
      break;
    case "ytd":
      fromDate.setUTCMonth(0, 1);
      break;
  }
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}
