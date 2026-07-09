"use client";

import { useMemo } from "react";

import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";

export interface HeatmapPoint {
  dateKey: string;
  value: number;
  label: string;
}

export function Heatmap({
  points,
  getColor,
}: {
  points: HeatmapPoint[];
  getColor: (value: number, hasData: boolean) => string;
}) {
  const weeks = useMemo(() => {
    if (points.length === 0) return [];
    const byDate = new Map(points.map((p) => [p.dateKey, p]));
    const sorted = [...points].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const start = dateKeyToUtcDate(sorted[0].dateKey);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = dateKeyToUtcDate(sorted[sorted.length - 1].dateKey);
    const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 7;
    const totalWeeks = Math.ceil(totalDays / 7);

    const result: { dateKey: string; data?: HeatmapPoint }[][] = [];
    for (let w = 0; w < totalWeeks; w++) {
      const week: { dateKey: string; data?: HeatmapPoint }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + w * 7 + d);
        const key = utcDateToKey(date);
        week.push({ dateKey: key, data: byDate.get(key) });
      }
      result.push(week);
    }
    return result;
  }, [points]);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data in this range yet.</p>;
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex w-fit gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => (
              <div
                key={cell.dateKey}
                className="size-3 rounded-sm"
                style={{ backgroundColor: getColor(cell.data?.value ?? 0, Boolean(cell.data)) }}
                title={cell.data?.label ?? cell.dateKey}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function pnlHeatColor(percent: number, hasData: boolean): string {
  if (!hasData) return "color-mix(in oklch, var(--muted-foreground) 8%, transparent)";
  if (percent === 0) return "color-mix(in oklch, var(--muted-foreground) 25%, transparent)";
  const intensity = Math.min(Math.abs(percent) / 3, 1);
  const base = percent > 0 ? "var(--success)" : "var(--danger)";
  const mixPct = 25 + intensity * 65;
  return `color-mix(in oklch, ${base} ${mixPct}%, var(--card))`;
}

export function psychologyHeatColor(percent: number, hasData: boolean): string {
  if (!hasData) return "color-mix(in oklch, var(--muted-foreground) 8%, transparent)";
  if (percent >= 80) return "var(--success)";
  if (percent >= 60) return "var(--warning)";
  return "var(--danger)";
}
