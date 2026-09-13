"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_AXIS_TICK, CHART_TOOLTIP_STYLE } from "@/components/analytics/chart-theme";
import type { CumulativeRComparison } from "@/domain/replay-comparison/types";

/** Forward-fills both series onto the union of their dates so two curves
 *  with different trade counts/dates still render on one shared X axis —
 *  the standard equity-curve-comparison merge, holding each series at its
 *  last known cumulative value between updates. */
function mergeCurves(comparison: CumulativeRComparison): { date: string; actual: number; replay: number }[] {
  const dates = Array.from(new Set([...comparison.actual.map((p) => p.dateKey), ...comparison.replay.map((p) => p.dateKey)])).sort();
  let ai = 0;
  let ri = 0;
  let actualValue = 0;
  let replayValue = 0;
  return dates.map((date) => {
    while (ai < comparison.actual.length && comparison.actual[ai].dateKey <= date) {
      actualValue = comparison.actual[ai].cumulativeR;
      ai += 1;
    }
    while (ri < comparison.replay.length && comparison.replay[ri].dateKey <= date) {
      replayValue = comparison.replay[ri].cumulativeR;
      ri += 1;
    }
    return { date, actual: actualValue, replay: replayValue };
  });
}

/**
 * "Actual vs Replay — Cumulative R" (Stage 15.2 §8). Both series start at 0.
 * Deliberately no shaded "gap" area by default — the space between the two
 * lines is the Outcome Gap, not a discrepancy; the trader can read it
 * directly from the two lines without an implied verdict.
 */
export function EdgeCumulativeRChart({ comparison }: { comparison: CumulativeRComparison }) {
  const data = mergeCurves(comparison);

  if (data.length < 2) {
    return (
      <div className="glass rounded-2xl p-4">
        <h3 className="mb-2 text-sm font-semibold">Actual vs Replay — Cumulative R</h3>
        <p className="py-10 text-center text-sm text-muted-foreground">Not enough finalized trades yet on either side.</p>
      </div>
    );
  }

  return (
    <div className="glass space-y-2 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Actual vs Replay — Cumulative R</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--chart-1)" }} /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--chart-2)" }} /> Replay
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={CHART_AXIS_TICK} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={40} />
          <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(0)}R`} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [`${Number(value).toFixed(2)}R`, name]} />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="replay" name="Replay" stroke="var(--chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-muted-foreground/60 italic">
        The space between the two lines is the Outcome Gap — not a discrepancy on its own.
      </p>
    </div>
  );
}
