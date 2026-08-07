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

import type { DiscrepancyPoint, DiscrepancySummary } from "@/domain/analytics/execution-engine";

const R = (n: number | null, sign = false) =>
  n == null ? "—" : `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
const PCT = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

const TREND_META: Record<DiscrepancySummary["gapTrend"], { label: string; className: string }> = {
  shrinking: { label: "Gap shrinking", className: "text-success" },
  stable: { label: "Gap stable", className: "text-muted-foreground" },
  growing: { label: "Gap growing", className: "text-danger" },
};

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
 * Discrepancy Gap — Expected vs Actual cumulative equity (in R), with the gap
 * between them shaded. Companion to the Equity Curve: it shows not just how much
 * was made, but how much of a proven edge execution actually captured. A discipline
 * measure, not a market prediction.
 */
export function DiscrepancyGapCard({
  curve,
  summary,
}: {
  curve: DiscrepancyPoint[];
  summary: DiscrepancySummary;
}) {
  // Range band [actual, expected] shades the gap between the two lines.
  const data = curve.map((p) => ({ ...p, gapBand: [p.actualEquity, p.expectedEquity] as [number, number] }));
  const trend = TREND_META[summary.gapTrend];

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Discrepancy Gap</h3>
        <span className={`text-xs font-medium ${trend.className}`}>{trend.label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Current gap" value={R(summary.currentGap, true)} tone={summary.currentGap > 0 ? "danger" : "success"} />
        <Metric label="Execution efficiency" value={PCT(summary.executionEfficiencyPercent)} />
        <Metric label="Recoverable" value={R(summary.recoverableR)} tone="warning" />
      </div>

      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No benchmarked trades yet — set a strategy&apos;s Expected expectancy in Strategy Lab.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={216}>
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
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
            />
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
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/40 p-2.5">
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
