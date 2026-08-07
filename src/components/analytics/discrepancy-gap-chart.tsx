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

import type { DiscrepancyPoint } from "@/domain/analytics/execution-engine";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

function GapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DiscrepancyPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: [string, string][] = [
    ["Expected", R(p.expectedEquity)],
    ["Actual", R(p.actualEquity)],
    ["Gap", R(p.gap, true)],
    ["Execution", p.executionScore == null ? "—" : `${p.executionScore}%`],
  ];
  return (
    <div className="rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-elevated">
      <div className="mb-1 font-medium">Trade #{p.tradeNumber}</div>
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
 * The Discrepancy-Gap dual-line chart — Expected (muted dashed) vs Actual (brand)
 * cumulative R, with the gap between them shaded. Shared by the Dashboard card and
 * the Analytics section. Identity is carried by the legend + line style (single
 * design-system chart pair), per the dataviz method.
 */
export function DiscrepancyGapChart({
  curve,
  height = 216,
}: {
  curve: DiscrepancyPoint[];
  height?: number;
}) {
  if (curve.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No benchmarked trades yet — set a strategy&apos;s Expected expectancy in Strategy Lab.
      </p>
    );
  }
  const data = curve.map((p) => ({
    ...p,
    gapBand: [p.actualEquity, p.expectedEquity] as [number, number],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="tradeNumber"
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
        <Tooltip content={<GapTooltip />} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
        <Area
          dataKey="gapBand"
          name="Gap"
          stroke="none"
          fill="var(--danger)"
          fillOpacity={0.12}
          activeDot={false}
          legendType="none"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="expectedEquity"
          name="Expected"
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
