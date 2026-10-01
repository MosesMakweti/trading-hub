"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { rechartsTooltip, type TooltipModel } from "@/components/viz/chart-tooltip";
import { formatTick, type ValueUnit } from "@/components/viz/format";
import { niceTicks } from "@/components/viz/series";
import { CHART, VIZ } from "@/components/viz/tokens";

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Mark colour (polarity / identity / sequential tint). Defaults to slot-1. */
  color?: string;
  tooltip: TooltipModel;
  /** Render this column's value above it (selective direct labels only). */
  showLabel?: boolean;
}

/**
 * ColumnChart — vertical columns for distributions and categorical
 * magnitudes (R histogram, trades by hour, weekday). Columns are ≤ 24px with a
 * 4px rounded data end and grow from one baseline (negative values grow
 * down); each column is its own hover/focus target with a TooltipCard.
 * Direct labels are selective (`showLabel`), never on every bar.
 */
export function ColumnChart({
  columns,
  unit = "count",
  height = 200,
  zeroLine = true,
  references = [],
  ariaLabel,
}: {
  columns: Column[];
  unit?: ValueUnit;
  height?: number;
  zeroLine?: boolean;
  /** Vertical reference markers between categories (e.g. the 0R split). */
  references?: { x: string; label?: string }[];
  ariaLabel: string;
}) {
  const values = columns.map((c) => c.value);
  const y = niceTicks(Math.min(0, ...values), Math.max(0, ...values, 1), 4);
  const tooltip = rechartsTooltip<Column>((c) => c.tooltip);
  const data = columns.map((c) => ({ ...c, labelText: c.showLabel ? formatTick(c.value, unit) : "" }));

  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ ...CHART.margin, top: 18 }} barCategoryGap="18%">
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="label" tick={{ ...CHART.tick, fontSize: 10 }} {...CHART.xAxis} interval="preserveStartEnd" minTickGap={4} />
          <YAxis tick={CHART.tick} {...CHART.yAxis} width={36} domain={y.domain} ticks={y.ticks} tickFormatter={(v: number) => formatTick(v, unit)} allowDecimals={false} />
          {zeroLine && <ReferenceLine y={0} stroke={VIZ.axis} />}
          {references.map((r) => (
            <ReferenceLine
              key={r.x}
              x={r.x}
              stroke={VIZ.reference}
              strokeDasharray={CHART.referenceDash}
              label={r.label ? { value: r.label, position: "top", fill: "var(--muted-foreground)", fontSize: 10 } : undefined}
            />
          ))}
          <Tooltip content={tooltip} cursor={{ fill: "var(--accent)", opacity: 0.5 }} isAnimationActive={false} />
          <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} animationDuration={CHART.animationMs}>
            {columns.map((c) => (
              <Cell key={c.key} fill={c.color ?? "var(--viz-1)"} />
            ))}
            {/* Label text lives ON the datum: LabelList skips zero-height bars,
                so an index lookup would drift onto the wrong column. */}
            <LabelList dataKey="labelText" position="top" offset={6} fill="var(--muted-foreground)" fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
