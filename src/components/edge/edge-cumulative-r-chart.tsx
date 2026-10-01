"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard } from "@/components/viz/chart-card";
import { ChartLegend } from "@/components/viz/chart-legend";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { daySpan, formatDateLong, formatDateTick, formatR, formatTick } from "@/components/viz/format";
import { niceTicks, timeTickIndices } from "@/components/viz/series";
import { CHART, SERIES, VIZ } from "@/components/viz/tokens";
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
 * Drawn as steps: the merge forward-fills each series between its own
 * updates, so a step (not a slope) is the honest shape between points.
 * Deliberately no shaded "gap" area by default — the space between the two
 * lines is the Outcome Gap, not a discrepancy; the trader can read it
 * directly from the two lines without an implied verdict.
 */
const ACTUAL = SERIES[0];
const REPLAY = SERIES[1];

export function EdgeCumulativeRChart({ comparison }: { comparison: CumulativeRComparison }) {
  const data = mergeCurves(comparison).map((d, index) => ({ ...d, index }));
  const last = data[data.length - 1];
  const span = data.length > 1 ? daySpan(data[0].date, last.date) : 0;
  const ticks = timeTickIndices(data.map((d) => d.date));
  const y = niceTicks(Math.min(0, ...data.flatMap((d) => [d.actual, d.replay])), Math.max(0, ...data.flatMap((d) => [d.actual, d.replay])), 5);

  const tooltip = rechartsTooltip<(typeof data)[number]>((d) => ({
    title: formatDateLong(d.date),
    rows: [
      { key: "a", label: "Actual", value: formatR(d.actual), color: ACTUAL },
      { key: "r", label: "Replay", value: formatR(d.replay), color: REPLAY },
      // Neutral ink on purpose: the Outcome Gap is not a verdict.
      { key: "g", label: "Outcome gap (actual − replay)", value: formatR(d.actual - d.replay), tone: "muted", mark: "none", separated: true },
    ],
  }));

  return (
    <ChartCard
      title="Actual vs Replay — Cumulative R"
      plotHeight={240}
      empty={data.length < 2 ? { title: "Not enough finalized trades yet on either side" } : null}
      legend={
        last && (
          <ChartLegend
            items={[
              { key: "a", label: "Actual", color: ACTUAL, mark: "line", value: formatR(last.actual) },
              { key: "r", label: "Replay", color: REPLAY, mark: "line", value: formatR(last.replay) },
            ]}
          />
        )
      }
      footer={<p className="text-[11px] text-muted-foreground/70 italic">The space between the two lines is the Outcome Gap — not a discrepancy on its own.</p>}
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ ...CHART.margin, right: 20 }}>
          <CartesianGrid {...CHART.grid} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[0, Math.max(0, data.length - 1)]}
            ticks={ticks}
            interval="preserveStartEnd"
            tickFormatter={(i: number) => (data[i] ? formatDateTick(data[i].date, span) : "")}
            tick={CHART.tick}
            {...CHART.xAxis}
          />
          <YAxis tick={CHART.tick} {...CHART.yAxis} width={44} domain={y.domain} ticks={y.ticks} tickFormatter={(v: number) => formatTick(v, "r")} />
          <ReferenceLine y={0} stroke={VIZ.axis} />
          <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="replay" name="Replay" stroke={REPLAY} strokeWidth={CHART.lineWidth} dot={false} activeDot={{ r: 4, fill: REPLAY, stroke: VIZ.surface, strokeWidth: 2 }} animationDuration={CHART.animationMs} />
          <Line type="stepAfter" dataKey="actual" name="Actual" stroke={ACTUAL} strokeWidth={CHART.lineWidth} dot={false} activeDot={{ r: 4, fill: ACTUAL, stroke: VIZ.surface, strokeWidth: 2 }} animationDuration={CHART.animationMs} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
