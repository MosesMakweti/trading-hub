"use client";

import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { daySpan, formatDateLong, formatDateTick, formatMoney, formatPct, formatTick } from "@/components/viz/format";
import { niceTicks, timeTickIndices } from "@/components/viz/series";
import { CHART, VIZ } from "@/components/viz/tokens";

export interface DrawdownCurvePoint {
  dateKey: string;
  balance: number;
  peak: number;
  drawdownAmount: number;
  drawdownPercent: number;
}

type Row = DrawdownCurvePoint & { index: number; value: number; recovering: boolean };

/** Analytics V2 §5 — drawdown through time from the same canonical
 *  Performance Account balance series drawdown/equity already share (never
 *  Prop Firm cashflows). Plotted underwater — % decline from the running
 *  peak — so the shape reads the same regardless of account size; the
 *  deepest point is marked, and the tooltip carries the $ amount, the peak
 *  it's measured from, and whether the account is recovering. Every value is
 *  the service's own drawdown series; nothing is recomputed. */
export function DrawdownChart({ curve, height = 200 }: { curve: DrawdownCurvePoint[]; height?: number }) {
  const uid = useId().replace(/:/g, "");

  const { rows, worst, spanDays, xTicks, y } = useMemo(() => {
    const rows: Row[] = curve.map((p, index) => {
      const prev = curve[index - 1];
      return {
        ...p,
        index,
        value: -p.drawdownPercent,
        recovering: prev != null && p.drawdownPercent > 0 && p.drawdownPercent < prev.drawdownPercent,
      };
    });
    const worst = rows.reduce<Row | null>(
      (w, r) => (r.drawdownPercent > 0 && (w == null || r.drawdownPercent > w.drawdownPercent) ? r : w),
      null,
    );
    return {
      rows,
      xTicks: timeTickIndices(rows.map((r) => r.dateKey)),
      y: niceTicks(Math.min(0, ...rows.map((r) => r.value)), 0, 4),
      worst,
      spanDays: rows.length > 1 ? daySpan(rows[0].dateKey, rows[rows.length - 1].dateKey) : 0,
    };
  }, [curve]);

  if (rows.length < 2) return null;

  const tooltip = rechartsTooltip<Row>((r) => ({
    title: formatDateLong(r.dateKey),
    rows:
      r.drawdownPercent > 0
        ? [
            { key: "pct", label: "Drawdown", value: formatPct(-r.drawdownPercent, 2), color: VIZ.loss, tone: "loss" },
            { key: "amt", label: "Below peak", value: formatMoney(-r.drawdownAmount), tone: "loss", mark: "none" },
            { key: "bal", label: "Balance", value: formatMoney(r.balance), separated: true, mark: "none" },
            { key: "peak", label: "Peak", value: formatMoney(r.peak), mark: "none" },
            { key: "state", label: "State", value: r.recovering ? "Recovering" : "Deepening / flat", tone: "muted", mark: "none" },
          ]
        : [
            { key: "pct", label: "Drawdown", value: "At peak", tone: "profit", color: VIZ.profit },
            { key: "bal", label: "Balance", value: formatMoney(r.balance), separated: true, mark: "none" },
          ],
  }));

  const last = rows[rows.length - 1];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ ...CHART.margin, top: 18 }}>
        <defs>
          <linearGradient id={`${uid}-dd`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VIZ.loss} stopOpacity={0.04} />
            <stop offset="100%" stopColor={VIZ.loss} stopOpacity={0.32} />
          </linearGradient>
        </defs>
        <CartesianGrid {...CHART.grid} />
        <XAxis
          dataKey="index"
          type="number"
          domain={[0, rows.length - 1]}
          ticks={xTicks}
          interval="preserveStartEnd"
          tickFormatter={(i: number) => (rows[i] ? formatDateTick(rows[i].dateKey, spanDays) : "")}
          tick={CHART.tick}
          {...CHART.xAxis}
          allowDecimals={false}
        />
        <YAxis
          tick={CHART.tick}
          {...CHART.yAxis}
          width={48}
          domain={y.domain}
          ticks={y.ticks}
          tickFormatter={(v: number) => formatTick(v, "percent")}
        />
        <ReferenceLine y={0} stroke={VIZ.axis} />
        {last.drawdownPercent > 0 && (
          <ReferenceLine
            y={-last.drawdownPercent}
            stroke={VIZ.reference}
            strokeDasharray={CHART.referenceDash}
            label={{ value: `Now ${formatPct(-last.drawdownPercent, 1)}`, position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 10 }}
          />
        )}
        <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
        <Area
          type="linear"
          dataKey="value"
          stroke={VIZ.loss}
          strokeWidth={1.5}
          fill={`url(#${uid}-dd)`}
          dot={false}
          activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2, fill: VIZ.loss }}
          animationDuration={CHART.animationMs}
        />
        {worst && (
          <ReferenceDot
            x={worst.index}
            y={worst.value}
            r={4}
            fill={VIZ.loss}
            stroke={VIZ.surface}
            strokeWidth={2}
            label={{ value: `Max ${formatPct(-worst.drawdownPercent, 1)}`, position: "bottom", fill: "var(--muted-foreground)", fontSize: 10 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
