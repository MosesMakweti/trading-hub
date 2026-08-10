"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DiscrepancyCurvePoint } from "@/domain/analytics/discrepancy-model";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

function VarianceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DiscrepancyCurvePoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: [string, string][] = [
    ["Discrepancy-free", R(p.discrepancyFreeEquity)],
    ["Actual", R(p.actualEquity)],
    ["Avoidable discrepancy", R(p.avoidableEquity)],
  ];
  return (
    <div className="rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-elevated">
      <div className="mb-1 font-medium">Trade #{p.sequence}</div>
      <div className="space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 tabular-nums">
            <span className="text-muted-foreground">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Actual vs Discrepancy-free cumulative R. The shaded band between them is the
 * AVOIDABLE DISCREPANCY — 1R for every trade the trader would not take again — i.e.
 * where equity would be without the avoidable trades. A losing trade you'd still
 * take adds nothing to the gap.
 */
export function DiscrepancyGapChart({
  curve,
  height = 216,
}: {
  curve: DiscrepancyCurvePoint[];
  height?: number;
}) {
  if (curve.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No trades yet — the avoidable-discrepancy gap builds as you answer “Would I take this trade
        again?” on each trade.
      </p>
    );
  }
  const data = curve.map((p) => ({
    ...p,
    avoidableBand: [p.actualEquity, p.discrepancyFreeEquity] as [number, number],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="sequence"
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          tickFormatter={(v: number) => `#${v}`}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => `${v.toFixed(0)}R`}
        />
        <Tooltip content={<VarianceTooltip />} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
        <Area
          dataKey="avoidableBand"
          name="Avoidable discrepancy"
          stroke="none"
          fill="var(--danger)"
          fillOpacity={0.12}
          activeDot={false}
          legendType="none"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="discrepancyFreeEquity"
          name="Discrepancy-free"
          stroke="var(--chart-2)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="actualEquity"
          name="Actual"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
