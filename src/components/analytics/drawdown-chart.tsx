"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_AXIS_TICK, CHART_TOOLTIP_STYLE } from "@/components/analytics/chart-theme";

export interface DrawdownCurvePoint {
  dateKey: string;
  balance: number;
  peak: number;
  drawdownAmount: number;
  drawdownPercent: number;
}

/** Analytics V2 §5 — drawdown through time from the same canonical
 *  Performance Account balance series drawdown/equity already share (never
 *  Prop Firm cashflows). Plotted as % decline from the running peak so the
 *  shape reads the same regardless of account size. */
export function DrawdownChart({ curve }: { curve: DrawdownCurvePoint[] }) {
  if (curve.length < 2) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {curve.length === 0 ? "No settled trades in this range yet." : "Just one settled trade so far."}
      </p>
    );
  }
  const data = curve.map((p) => ({ date: p.dateKey, value: -p.drawdownPercent }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--danger)" stopOpacity={0} />
            <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={CHART_AXIS_TICK} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={40} />
        <YAxis
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={44}
          domain={["dataMin", 0]}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value) => [`${Math.abs(Number(value)).toFixed(2)}%`, "Drawdown"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--danger)"
          strokeWidth={1.5}
          fill="url(#drawdownFill)"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
