"use client";

import { useState } from "react";
import Link from "next/link";
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

import type { CounterfactualPoint, LeakageEvent } from "@/domain/analytics/counterfactual-engine";
import { CATEGORY_LABEL, LEAKAGE_TONE } from "@/components/analytics/leakage-meta";

const R = (n: number, sign = false) => `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

function GapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="max-w-56 rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-elevated">
      <div className="mb-1 font-medium">
        {p.kind === "MISSED" ? "Missed setup" : `Trade #${p.sequence}`}
      </div>
      <div className="space-y-0.5 tabular-nums">
        <Row k="Actual" v={R(p.actualEquity, true)} />
        <Row k="Process-perfect" v={R(p.processPerfectEquity, true)} />
        <Row k="Avoidable so far" v={R(p.avoidableGap)} />
      </div>
      {p.leakages.length > 0 && (
        <div className="mt-1.5 border-t border-border pt-1.5 text-[11px] text-muted-foreground">
          {p.leakages.map((l, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span>{l.label}</span>
              <span>{l.rImpact == null ? "flagged" : R(l.rImpact)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

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
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No trades or valid opportunities in this range yet.
      </p>
    );
  }

  const data: ChartPoint[] = curve.map((p) => ({
    ...p,
    avoidBand: [p.actualEquity, Math.max(p.actualEquity, p.processPerfectEquity)],
  }));

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
          onClick={(e) => {
            const idx = (e as { activeTooltipIndex?: number | null })?.activeTooltipIndex;
            if (idx != null && idx >= 0 && idx < data.length) setSelected(data[idx]);
          }}
        >
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
          <Tooltip content={<GapTooltip />} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
          <Area
            dataKey="avoidBand"
            name="Avoidable gap"
            stroke="none"
            fill="var(--chart-4)"
            fillOpacity={0.14}
            activeDot={false}
            legendType="none"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="processPerfectEquity"
            name="Process-perfect"
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
            dot={{ r: 2.5, fill: "var(--chart-1)", cursor: "pointer" }}
            activeDot={{ r: 5, cursor: "pointer" }}
          />
        </ComposedChart>
      </ResponsiveContainer>

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
