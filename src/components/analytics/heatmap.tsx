"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { MarkTooltip } from "@/components/viz/mark-tooltip";
import { formatDateLong, formatPct } from "@/components/viz/format";
import { VIZ } from "@/components/viz/tokens";

export interface HeatmapPoint {
  dateKey: string;
  value: number;
  label: string;
}

type Scale = "pnl" | "psychology";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/**
 * Calendar heatmap — one cell per day, weeks as columns (Sun→Sat), with month
 * labels across the top, weekday labels down the side and a scale legend, so
 * the colour is readable without guessing. Each cell is a focusable hover
 * target with the shared TooltipCard.
 *
 *  - `scale="pnl"`: diverging — loss ← neutral grey → profit, intensity by |%|.
 *  - `scale="psychology"`: the existing ≥80 / ≥60 / <60 status bands.
 * `getColor` is still accepted for custom scales.
 */
export function Heatmap({
  points,
  getColor,
  scale = "pnl",
  valueLabel = scale === "pnl" ? "Return" : "Psychology",
}: {
  points: HeatmapPoint[];
  getColor?: (value: number, hasData: boolean) => string;
  scale?: Scale;
  valueLabel?: string;
}) {
  const color = getColor ?? (scale === "pnl" ? pnlHeatColor : psychologyHeatColor);

  const { weeks, monthLabels, summary } = useMemo(() => {
    if (points.length === 0) return { weeks: [], monthLabels: [], summary: null };
    const byDate = new Map(points.map((p) => [p.dateKey, p]));
    const sorted = [...points].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const start = dateKeyToUtcDate(sorted[0].dateKey);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = dateKeyToUtcDate(sorted[sorted.length - 1].dateKey);
    const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 7;
    const totalWeeks = Math.ceil(totalDays / 7);

    const weeks: { dateKey: string; data?: HeatmapPoint }[][] = [];
    const monthLabels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < totalWeeks; w++) {
      const week: { dateKey: string; data?: HeatmapPoint }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + w * 7 + d);
        const key = utcDateToKey(date);
        week.push({ dateKey: key, data: byDate.get(key) });
        if (date.getUTCDate() === 1 || (w === 0 && d === 0)) {
          const m = date.getUTCMonth();
          if (m !== lastMonth) {
            // A partial leading month would collide with the next label — keep the later one.
            const prev = monthLabels[monthLabels.length - 1];
            if (prev && w - prev.week < 3) monthLabels.pop();
            monthLabels.push({ week: w, label: MONTHS[m] });
            lastMonth = m;
          }
        }
      }
      weeks.push(week);
    }
    const ups = points.filter((p) => p.value > 0).length;
    const downs = points.filter((p) => p.value < 0).length;
    return { weeks, monthLabels, summary: { days: points.length, ups, downs } };
  }, [points]);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data in this range yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="w-fit">
          {/* Month labels, aligned to their week column (cell 12px + gap 4px). */}
          <div className="relative mb-1 ml-8 h-3.5 text-[10px] text-muted-foreground">
            {monthLabels.map((m) => (
              <span key={`${m.week}-${m.label}`} className="absolute top-0" style={{ left: m.week * 16 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <div className="flex w-7 flex-col gap-1 pr-1 text-right text-[9px] leading-3 text-muted-foreground" aria-hidden>
              {WEEKDAY_LABELS.map((l, i) => (
                <span key={i} className="h-3">
                  {l}
                </span>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((cell) => {
                  const has = Boolean(cell.data);
                  const swatch = color(cell.data?.value ?? 0, has);
                  if (!has) {
                    return <span key={cell.dateKey} className="size-3 rounded-[3px]" style={{ backgroundColor: swatch }} aria-hidden />;
                  }
                  const v = cell.data!.value;
                  return (
                    <MarkTooltip
                      key={cell.dateKey}
                      model={{
                        title: formatDateLong(cell.dateKey),
                        rows: [
                          {
                            key: "v",
                            label: valueLabel,
                            value: scale === "pnl" ? formatPct(v, 2, true) : formatPct(v, 0),
                            color: swatch,
                            mark: "swatch",
                            tone: scale === "pnl" ? (v > 0 ? "profit" : v < 0 ? "loss" : "muted") : undefined,
                          },
                        ],
                      }}
                    >
                      <button
                        type="button"
                        aria-label={cell.data!.label}
                        className="size-3 rounded-[3px] outline-none transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ backgroundColor: swatch }}
                      />
                    </MarkTooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
        {scale === "pnl" ? (
          <div className="flex items-center gap-1.5" aria-label="Colour scale: loss to profit">
            <span>Loss</span>
            {[-3, -1.5, -0.4, 0, 0.4, 1.5, 3].map((v) => (
              <span key={v} className="size-3 rounded-[3px]" style={{ backgroundColor: pnlHeatColor(v, true) }} aria-hidden />
            ))}
            <span>Profit</span>
            <span className="ml-1 text-muted-foreground/70">(±3%+ = full)</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {[
              { v: 85, l: "≥ 80%" },
              { v: 70, l: "60–79%" },
              { v: 40, l: "< 60%" },
            ].map((b) => (
              <span key={b.l} className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px]" style={{ backgroundColor: psychologyHeatColor(b.v, true) }} aria-hidden />
                {b.l}
              </span>
            ))}
          </div>
        )}
        {summary && scale === "pnl" && (
          <span className={cn("tabular-nums")}>
            {summary.days} trading days · {summary.ups} up · {summary.downs} down
          </span>
        )}
      </div>
    </div>
  );
}

export function pnlHeatColor(percent: number, hasData: boolean): string {
  if (!hasData) return "color-mix(in oklch, var(--muted-foreground) 8%, transparent)";
  if (percent === 0) return VIZ.neutral;
  const intensity = Math.min(Math.abs(percent) / 3, 1);
  const base = percent > 0 ? VIZ.profit : VIZ.loss;
  const mixPct = 25 + intensity * 65;
  return `color-mix(in oklch, ${base} ${mixPct}%, var(--card))`;
}

export function psychologyHeatColor(percent: number, hasData: boolean): string {
  if (!hasData) return "color-mix(in oklch, var(--muted-foreground) 8%, transparent)";
  if (percent >= 80) return VIZ.profit;
  if (percent >= 60) return VIZ.warning;
  return VIZ.loss;
}
