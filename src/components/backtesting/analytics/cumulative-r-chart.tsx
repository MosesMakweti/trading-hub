"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_AXIS_TICK, CHART_TOOLTIP_STYLE } from "@/components/analytics/chart-theme";
import { fmtR } from "@/lib/analytics-format";
import type { FinalizedRCurvePoint } from "@/domain/analytics/canonical-aggregations";

/**
 * Backtesting's primary performance chart: cumulative R over finalized
 * trades in simulated-market order (x = trade sequence, so several trades on
 * one day stay distinct), with the R drawdown from the running peak as a
 * shaded band. Origin (0R before the first trade) is always plotted.
 */
export function CumulativeRChart({ curve }: { curve: FinalizedRCurvePoint[] }) {
  if (curve.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No closed trades yet — the curve starts with the first finalized result.</p>;
  }
  const data = [
    { index: 0, dateKey: "Start", r: 0, cumulativeR: 0, drawdownR: 0 },
    ...curve.map((p) => ({ index: p.index, dateKey: p.dateKey, r: p.r, cumulativeR: p.cumulativeR, drawdownR: p.drawdownR })),
  ];
  const final = curve[curve.length - 1].cumulativeR;
  const lineColor = final >= 0 ? "var(--success)" : "var(--danger)";

  const maxDrawdown = Math.min(0, ...curve.map((p) => p.drawdownR));
  return (
    <figure>
      <figcaption className="sr-only">
        Cumulative R over {curve.length} closed trade{curve.length === 1 ? "" : "s"}, ending at {fmtR(final)}, with a maximum drawdown
        of {fmtR(maxDrawdown)}.
      </figcaption>
      <div aria-hidden>
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="btDrawdownFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.05} />
            <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="index"
          tick={CHART_AXIS_TICK}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          minTickGap={24}
          label={{ value: "Trade #", position: "insideBottomRight", offset: -2, fill: "var(--muted-foreground)", fontSize: 10 }}
        />
        <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `${v.toFixed(0)}R`} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelFormatter={(_, payload) => {
            const p = payload?.[0]?.payload as { index: number; dateKey: string } | undefined;
            return p ? (p.index === 0 ? "Start" : `Trade ${p.index} · ${p.dateKey}`) : "";
          }}
          formatter={(value, name) => [fmtR(Number(value)), name === "cumulativeR" ? "Cumulative" : name === "drawdownR" ? "Drawdown" : "Trade"]}
        />
        <Area type="linear" dataKey="drawdownR" stroke="none" fill="url(#btDrawdownFill)" isAnimationActive={false} />
        <Line type="linear" dataKey="cumulativeR" stroke={lineColor} strokeWidth={2} dot={curve.length <= 40 ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
      </div>
    </figure>
  );
}
