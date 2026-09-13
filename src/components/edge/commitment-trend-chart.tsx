"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_AXIS_TICK, CHART_TOOLTIP_STYLE } from "@/components/analytics/chart-theme";
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
    return <p className="py-8 text-center text-xs text-muted-foreground/60 italic">No applicable observations in any period yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="key" tick={CHART_AXIS_TICK} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} width={32} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(_value, _name, item) => {
            const p = item.payload as (typeof data)[number];
            if (p.percent == null) return ["no data", "Adherence"];
            return [`${p.percent}% (${p.followed}/${p.applicable} followed)`, "Adherence"];
          }}
        />
        <Line
          type="monotone"
          dataKey="percent"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-1)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
