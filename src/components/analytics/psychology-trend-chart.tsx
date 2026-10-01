"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard } from "@/components/viz/chart-card";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { formatPct } from "@/components/viz/format";
import { CHART, VIZ } from "@/components/viz/tokens";
import type { TrendPoint } from "@/domain/psychology/analytics";

export function PsychologyTrendChart({
  byWeek,
  byMonth,
}: {
  byWeek: TrendPoint[];
  byMonth: TrendPoint[];
}) {
  const [mode, setMode] = useState<"week" | "month">("month");
  const data = (mode === "month" ? byMonth : byWeek).map((p, i, arr) => ({
    key: p.key,
    percent: p.averagePercent,
    change: i > 0 ? p.averagePercent - arr[i - 1].averagePercent : null,
  }));
  const last = data[data.length - 1];
  const band = (v: number) => (v >= 80 ? "Strong (≥ 80%)" : v >= 60 ? "Watch (60–79%)" : "Weak (< 60%)");
  const tooltip = rechartsTooltip<(typeof data)[number]>((p) => ({
    title: p.key,
    rows: [
      { key: "v", label: "Avg discipline", value: formatPct(p.percent, 1), color: "var(--viz-1)" },
      ...(p.change != null
        ? [{ key: "c", label: `vs previous ${mode}`, value: formatPct(p.change, 1, true), tone: p.change > 0 ? ("profit" as const) : p.change < 0 ? ("loss" as const) : ("muted" as const), mark: "none" as const }]
        : []),
      { key: "b", label: "Band", value: band(p.percent), tone: "muted" as const, mark: "none" as const, separated: true },
    ],
  }));

  return (
    <ChartCard
      title="Psychology Trend"
      plotHeight={240}
      headline={last ? { value: formatPct(last.percent, 0), caption: last.change != null ? `${formatPct(last.change, 1, true)} vs previous ${mode} · ${band(last.percent)}` : band(last.percent) } : undefined}
      actions={
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList aria-label="Period">
            <TabsTrigger value="week">Weekly</TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      empty={data.length === 0 ? { title: "No completed questionnaires in this range yet" } : null}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ ...CHART.margin, right: 16 }}>
          {/* Status bands (good / watch / weak) — the thresholds the heatmap uses. */}
          <ReferenceArea y1={80} y2={100} fill={VIZ.profit} fillOpacity={0.06} label={{ value: "≥ 80", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          <ReferenceArea y1={60} y2={80} fill={VIZ.warning} fillOpacity={0.06} label={{ value: "60–79", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          <ReferenceArea y1={0} y2={60} fill={VIZ.loss} fillOpacity={0.05} label={{ value: "< 60", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="key" tick={CHART.tick} {...CHART.xAxis} />
          <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={CHART.tick} {...CHART.yAxis} width={36} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
          <Line
            type="linear"
            dataKey="percent"
            stroke="var(--viz-1)"
            strokeWidth={CHART.lineWidth}
            dot={{ r: 3.5, fill: "var(--viz-1)", stroke: VIZ.surface, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "var(--viz-1)", stroke: VIZ.surface, strokeWidth: 2 }}
            animationDuration={CHART.animationMs}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
