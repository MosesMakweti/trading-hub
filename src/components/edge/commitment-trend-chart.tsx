"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyPlot } from "@/components/viz/chart-card";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { CHART, VIZ } from "@/components/viz/tokens";
import { formatDateKeyShort } from "@/lib/date";
import type { CommitmentLineageSegmentDTO } from "@/types/edge-improvements";

/**
 * Restrained per-lineage adherence trend chart (Stage 19.1 §12-13) — one
 * point per review-period segment. A period with zero applicable
 * observations renders as a gap (`percent: null`, `connectNulls={false}`),
 * never as 0% — recharts skips a `null` y-value entirely rather than
 * drawing a misleading dip to the axis. Sample size is shown directly in
 * the tooltip so "100% · 1 observation" is never visually indistinguishable
 * from "100% · 20 observations" (§13) — no fabricated confidence interval.
 */
export function CommitmentTrendChart({ segments }: { segments: CommitmentLineageSegmentDTO[] }) {
  const data = segments.map((s) => ({
    key: `${formatDateKeyShort(s.periodStart)}${s.reviewType === "MONTHLY" ? " (mo)" : ""}`,
    percent: s.adherence.adherencePercent,
    followed: s.adherence.followed,
    breached: s.adherence.breached,
    applicable: s.adherence.applicableObservations,
  }));

  const hasAnyData = data.some((d) => d.percent != null);
  if (!hasAnyData) {
    return <EmptyPlot height={180} title="No applicable observations in any period yet" />;
  }

  const tooltip = rechartsTooltip<(typeof data)[number]>((p) => ({
    title: p.key,
    rows:
      p.percent == null
        ? [{ key: "n", label: "Adherence", value: "no applicable observations", tone: "muted", mark: "none" }]
        : [
            { key: "p", label: "Adherence", value: `${p.percent}%`, color: "var(--viz-1)" },
            { key: "f", label: "Followed", value: `${p.followed} of ${p.applicable}`, mark: "none" },
            { key: "b", label: "Breached", value: String(p.breached), tone: p.breached > 0 ? "loss" : "muted", mark: "none" },
          ],
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid {...CHART.grid} />
        <XAxis dataKey="key" tick={CHART.tick} {...CHART.xAxis} />
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={CHART.tick} {...CHART.yAxis} width={36} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
        <Line
          type="linear"
          dataKey="percent"
          stroke="var(--viz-1)"
          strokeWidth={CHART.lineWidth}
          dot={{ r: 3.5, fill: "var(--viz-1)", stroke: VIZ.surface, strokeWidth: 2 }}
          activeDot={{ r: 5, fill: "var(--viz-1)", stroke: VIZ.surface, strokeWidth: 2 }}
          connectNulls={false}
          animationDuration={CHART.animationMs}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
