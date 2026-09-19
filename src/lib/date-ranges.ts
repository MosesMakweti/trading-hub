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

export function presetToRange(
  preset: Exclude<DateRangePreset, "custom">,
  today: Date = new Date(),
): DateRange {
  const to = localDateToKey(today);
  if (preset === "all") return { from: ALL_TIME_FROM, to };
  const fromDate = new Date(today);
  switch (preset) {
    case "week":
      fromDate.setDate(fromDate.getDate() - 6);
      break;
    case "month":
      fromDate.setMonth(fromDate.getMonth() - 1);
      break;
    case "3months":
      fromDate.setMonth(fromDate.getMonth() - 3);
      break;
    case "year":
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      break;
    case "ytd":
      fromDate.setMonth(0, 1);
      break;
  }
  return { from: localDateToKey(fromDate), to };
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}
