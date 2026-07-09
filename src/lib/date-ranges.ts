import { localDateToKey } from "@/lib/date";

export type DateRangePreset = "week" | "month" | "3months" | "year" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  week: "This Week",
  month: "This Month",
  "3months": "Last 3 Months",
  year: "This Year",
  custom: "Custom Range",
};

export function presetToRange(
  preset: Exclude<DateRangePreset, "custom">,
  today: Date = new Date(),
): DateRange {
  const to = localDateToKey(today);
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
  }
  return { from: localDateToKey(fromDate), to };
}

export function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}
