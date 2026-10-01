"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CounterfactualPoint, LeakageEvent } from "@/domain/analytics/counterfactual-engine";
import { CATEGORY_LABEL, LEAKAGE_TONE } from "@/components/analytics/leakage-meta";
import { ChartLegend } from "@/components/viz/chart-legend";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { EmptyPlot } from "@/components/viz/chart-card";
import { formatDateLong, formatR, formatTick } from "@/components/viz/format";
import { niceTicks } from "@/components/viz/series";
import { CHART, SERIES, VIZ } from "@/components/viz/tokens";

const R = (n: number, sign = false) => formatR(n, 2, sign);

const ACTUAL = SERIES[0];

const tooltip = rechartsTooltip<ChartPoint>((p) => {
  const gap = p.processPerfectEquity - p.actualEquity;
  return {
    title: p.kind === "MISSED" ? `Missed setup · #${p.sequence}` : `Trade #${p.sequence}`,
    subtitle: formatDateLong(p.dateKey),
    rows: [
      { key: "a", label: "Actual", value: R(p.actualEquity, true), color: ACTUAL },
      { key: "p", label: "Process-perfect", value: R(p.processPerfectEquity, true), color: VIZ.reference, mark: "dash" },
      { key: "g", label: "Gap here", value: R(-gap, true), tone: gap > 0.005 ? "loss" : gap < -0.005 ? "profit" : "muted", mark: "none", separated: true },
      { key: "s", label: "This event avoidable", value: p.stepAvoidableR > 0 ? R(-p.stepAvoidableR, true) : "none", tone: p.stepAvoidableR > 0 ? "loss" : "muted", mark: "none" },
      { key: "c", label: "Avoidable so far", value: R(-p.avoidableGap, true), tone: p.avoidableGap > 0 ? "loss" : "muted", mark: "none" },
      ...p.leakages.map((l, i) => ({
        key: `l${i}`,
        label: l.label,
        value: l.rImpact == null ? "flagged" : R(l.rImpact),
        color: LEAKAGE_TONE[l.category],
        mark: "swatch" as const,
        separated: i === 0,
      })),
    ],
    footer: p.kind === "EXECUTED" ? "Click to inspect this trade" : undefined,
  };
});

interface ChartPoint extends CounterfactualPoint {
  // Band shaded ONLY where the disciplined line is above actual (recoverable edge).
  avoidBand: [number, number];
}

/**
 * Actual Equity vs Process-Perfect Equity. The shaded band is the cumulative
 * AVOIDABLE discrepancy only (clipped to Process-Perfect ≥ Actual) — normal
 * strategy variance is never shaded, and where the trader got lucky on a breach the
 * Actual line simply rises above the disciplined line (unshaded). Click any point to
 * inspect exactly which deviations moved the gap.
 */
export function CounterfactualGapChart({
  curve,
  height = 216,
}: {
  curve: CounterfactualPoint[];
  height?: number;
}) {
  const [selected, setSelected] = useState<ChartPoint | null>(null);

  if (curve.length === 0) {
    return <EmptyPlot height={height} title="No trades or valid opportunities in this range yet" />;
  }

  const data: ChartPoint[] = curve.map((p) => ({
    ...p,
    avoidBand: [p.actualEquity, Math.max(p.actualEquity, p.processPerfectEquity)],
  }));
  const y = niceTicks(
    Math.min(0, ...data.map((p) => Math.min(p.actualEquity, p.processPerfectEquity))),
    Math.max(0, ...data.map((p) => Math.max(p.actualEquity, p.processPerfectEquity))),
    5,
  );
  const last = data[data.length - 1];

  return (
    <div className="space-y-2">
      <ChartLegend
        items={[
          { key: "a", label: "Actual", color: ACTUAL, mark: "line", value: R(last.actualEquity, true) },
          { key: "p", label: "Process-perfect", color: VIZ.reference, mark: "dash", value: R(last.processPerfectEquity, true) },
          { key: "g", label: "Avoidable gap", color: "color-mix(in oklch, var(--viz-loss) 22%, var(--card))", mark: "swatch", value: R(-last.avoidableGap, true) },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ ...CHART.margin, right: 16 }}
          onClick={(e) => {
            const idx = (e as { activeTooltipIndex?: number | null })?.activeTooltipIndex;
            if (idx != null && idx >= 0 && idx < data.length) setSelected(data[idx]);
          }}
        >
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="sequence" tick={CHART.tick} {...CHART.xAxis} tickFormatter={(v: number) => `#${v}`} minTickGap={28} />
          <YAxis tick={CHART.tick} {...CHART.yAxis} width={44} domain={y.domain} ticks={y.ticks} tickFormatter={(v: number) => formatTick(v, "r")} />
          <ReferenceLine y={0} stroke={VIZ.axis} />
          <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
          <Area
            dataKey="avoidBand"
            name="Avoidable gap"
            stroke="none"
            fill={VIZ.loss}
            fillOpacity={0.12}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="processPerfectEquity"
            name="Process-perfect"
            stroke={VIZ.reference}
            strokeWidth={1.5}
            strokeDasharray={CHART.referenceDash}
            dot={false}
            activeDot={{ r: 3, stroke: VIZ.surface, strokeWidth: 2, fill: VIZ.reference }}
            animationDuration={CHART.animationMs}
          />
          <Line
            type="linear"
            dataKey="actualEquity"
            name="Actual"
            stroke={ACTUAL}
            strokeWidth={CHART.lineWidth}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const p = props.index != null ? data[props.index] : undefined;
              if (!p || props.cx == null || props.cy == null || data.length > 60) return <g key={`d-${props.index}`} />;
              return p.kind === "MISSED" ? (
                <circle key={`d-${props.index}`} cx={props.cx} cy={props.cy} r={3} fill={VIZ.surface} stroke={ACTUAL} strokeWidth={1.5} />
              ) : (
                <circle key={`d-${props.index}`} cx={props.cx} cy={props.cy} r={2.5} fill={ACTUAL} />
              );
            }}
            activeDot={{ r: 5, stroke: VIZ.surface, strokeWidth: 2, fill: ACTUAL, cursor: "pointer" }}
            animationDuration={CHART.animationMs}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-muted-foreground/70">Filled dots are trades taken · hollow dots are missed valid setups · click a point to inspect it.</p>

      {selected && (
        <div className="rounded-xl border border-border bg-background/40 p-3 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium">
              {selected.kind === "MISSED" ? "Missed valid setup" : `Trade #${selected.sequence}`}
              <span className="ml-2 text-muted-foreground">
                {selected.stepAvoidableR > 0 ? `+${selected.stepAvoidableR.toFixed(2)}R avoidable` : "no avoidable R"}
              </span>
            </span>
            {selected.kind === "EXECUTED" && (
              <Link
                href={`/journal/${selected.dateKey}/trades/${selected.eventId}`}
                className="text-primary hover:underline"
              >
                Open trade →
              </Link>
            )}
          </div>
          {selected.leakages.length === 0 ? (
            <p className="text-muted-foreground">Clean execution — no deviation from process.</p>
          ) : (
            <ul className="space-y-1">
              {selected.leakages.map((l: LeakageEvent, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ background: LEAKAGE_TONE[l.category] }} />
                    <span>{l.label}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{CATEGORY_LABEL[l.category]}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {l.rImpact == null ? "flagged" : R(l.rImpact)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
