"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  ConfluenceStat,
  SetupQualityBucket,
  SetupQualityTrendPoint,
} from "@/domain/performance/adherence-analytics";
import { EmptyPlot } from "@/components/viz/chart-card";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { formatPct } from "@/components/viz/format";
import { CHART, VIZ, tint } from "@/components/viz/tokens";

// The whole adherence view is a magnitude story (win rate / average score), so
// every mark is ONE data hue (slot 1) — identity is carried by the axis text
// (band letters, confluence names), never by color alone. See the dataviz skill.

const HUE = "var(--viz-1)";

function EmptyChart({ label }: { label: string }) {
  return <EmptyPlot height={200} title={label} />;
}

// Ordered quality bands get an ordinal single-hue ramp (A+ full → Low light),
// reinforcing the order without a categorical palette.
const BAND_SHARE: Record<string, number> = { "A+": 100, A: 82, B: 64, C: 48, Low: 34 };

const qualityTooltip = rechartsTooltip<SetupQualityBucket>((p) => ({
  title: `${p.label} setups`,
  rows: [
    { key: "w", label: "Win rate", value: p.winRate == null ? "—" : formatPct(p.winRate, 1), color: tint(HUE, BAND_SHARE[p.label] ?? 60), mark: "swatch" },
    { key: "t", label: "Trades", value: String(p.trades), mark: "none" },
    { key: "s", label: "Avg setup score", value: p.avgScore == null ? "—" : String(p.avgScore), mark: "none" },
  ],
}));

const confluenceTooltip = rechartsTooltip<ConfluenceStat>((c) => ({
  title: c.name,
  rows: [
    { key: "w", label: "Win rate", value: c.winRate == null ? "—" : formatPct(c.winRate, 1), color: HUE, mark: "swatch" },
    { key: "r", label: "Record", value: `${c.wins}W · ${c.losses}L`, mark: "none" },
  ],
}));

/** Setup Quality → Win Rate: does a higher weighted setup score actually win more? */
export function SetupQualityChart({ data }: { data: SetupQualityBucket[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No rated setups in this range yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid {...CHART.grid} />
        <XAxis dataKey="label" tick={CHART.tick} {...CHART.xAxis} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={CHART.tick} {...CHART.yAxis} width={40} tickFormatter={(v: number) => `${v}%`} />
        <ReferenceLine
          y={50}
          stroke={VIZ.reference}
          strokeDasharray={CHART.referenceDash}
          label={{ value: "50%", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }}
        />
        <Tooltip content={qualityTooltip} cursor={{ fill: "var(--accent)", opacity: 0.5 }} isAnimationActive={false} />
        <Bar dataKey="winRate" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={CHART.animationMs}>
          {data.map((d) => (
            <Cell key={d.rating} fill={tint(HUE, BAND_SHARE[d.label] ?? 60)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-confluence win rate — horizontal bars, ranked. */
export function ConfluenceWinRateChart({ data }: { data: ConfluenceStat[] }) {
  const rows = data.filter((c) => c.winRate != null).slice(0, 8);
  if (rows.length === 0) {
    return <EmptyChart label="No decided trades with confluences yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 34 + 24)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid stroke={VIZ.grid} horizontal={false} vertical />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={CHART.tick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
        <YAxis type="category" dataKey="name" tick={CHART.tick} axisLine={false} tickLine={false} width={112} />
        <ReferenceLine x={50} stroke={VIZ.reference} strokeDasharray={CHART.referenceDash} />
        <Tooltip content={confluenceTooltip} cursor={{ fill: "var(--accent)", opacity: 0.5 }} isAnimationActive={false} />
        <Bar dataKey="winRate" radius={[0, 4, 4, 0]} maxBarSize={18} fill={HUE} animationDuration={CHART.animationMs} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Average setup score over time — the discipline trend. */
export function SetupQualityTrendChart({ data }: { data: SetupQualityTrendPoint[] }) {
  if (data.length < 2) {
    return <EmptyChart label="Not enough months to chart a trend yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid {...CHART.grid} />
        <XAxis dataKey="month" tick={CHART.tick} {...CHART.xAxis} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={CHART.tick} {...CHART.yAxis} width={40} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip content={trendTooltip(data)} cursor={CHART.cursor} isAnimationActive={false} />
        <Line
          type="linear"
          dataKey="avgScore"
          stroke={HUE}
          strokeWidth={CHART.lineWidth}
          dot={{ r: 3.5, fill: HUE, stroke: VIZ.surface, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: HUE, stroke: VIZ.surface, strokeWidth: 2 }}
          animationDuration={CHART.animationMs}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function trendTooltip(data: SetupQualityTrendPoint[]) {
  return rechartsTooltip<SetupQualityTrendPoint>((p) => {
    const i = data.indexOf(p);
    const prev = i > 0 ? data[i - 1] : null;
    const change = prev && p.avgScore != null && prev.avgScore != null ? p.avgScore - prev.avgScore : null;
    return {
      title: p.month,
      rows: [
        { key: "s", label: "Avg setup score", value: p.avgScore == null ? "—" : p.avgScore.toFixed(1), color: HUE },
        ...(change != null
          ? [{ key: "c", label: `vs ${prev!.month}`, value: `${change >= 0 ? "+" : "\u2212"}${Math.abs(change).toFixed(1)}`, tone: change > 0 ? ("profit" as const) : change < 0 ? ("loss" as const) : ("muted" as const), mark: "none" as const }]
          : []),
        { key: "t", label: "Trades", value: String(p.trades), mark: "none" as const },
      ],
    };
  });
}

