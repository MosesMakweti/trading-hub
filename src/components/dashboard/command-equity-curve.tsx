"use client";

import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EquityCurvePoint } from "@/domain/performance/rr";

export interface ExpectedVsActualPoint {
  dateKey: string;
  cumulativeExpectedR: number;
  cumulativeActualR: number;
}

type Mode = "percent" | "r" | "dollar" | "comparison";

const MODE_LABEL: Record<Mode, string> = {
  percent: "%",
  r: "R",
  dollar: "$",
  comparison: "Expected vs Actual",
};

/** Adds a `peak` running-maximum and `underwater` (peak − value, ≥ 0) column to
 *  a value series — `underwater`, stacked on top of `value` in the chart, is
 *  the standard recharts "band between two lines" technique for drawdown
 *  shading: it visually fills the gap between the equity line and its own
 *  running peak, and collapses to nothing at a new high. */
function withDrawdown<T extends { value: number }>(points: T[]) {
  let peak = points.length > 0 ? points[0].value : 0;
  return points.map((p) => {
    if (p.value > peak) peak = p.value;
    return { ...p, peak, underwater: Math.max(0, peak - p.value) };
  });
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Command-center equity curve: %/R/$ value modes (all three derived from the
 * SAME real Performance-Account $ P&L pipeline `analytics.service.ts` already
 * builds — "R" here is the app's existing additive-return convention, matching
 * how Expectancy/Profit-Factor are already labeled elsewhere, not a second,
 * separately-computed R-multiple system) plus an Expected-vs-Actual R
 * comparison mode built from each trade's real `expectedRR`/`actualRR`.
 * Deliberately a separate component from `analytics/equity-curve-chart.tsx`
 * (kept untouched — 4 other pages depend on its plain `{ data }` contract).
 */
export function CommandEquityCurve({
  data,
  startingBalance,
  expectedVsActual,
}: {
  data: EquityCurvePoint[];
  startingBalance: number;
  expectedVsActual: ExpectedVsActualPoint[];
}) {
  const [mode, setMode] = useState<Mode>("percent");

  const valueChartData = useMemo(() => {
    const points = data.map((d) => ({
      date: d.dateKey,
      value:
        mode === "dollar"
          ? startingBalance * (1 + d.cumulativeCompounding / 100)
          : mode === "r"
            ? d.cumulativeAdditive
            : d.cumulativeCompounding,
    }));
    return withDrawdown(points);
  }, [data, mode, startingBalance]);

  const comparisonChartData = useMemo(
    () =>
      expectedVsActual.map((p) => ({
        date: p.dateKey,
        expected: p.cumulativeExpectedR,
        actual: p.cumulativeActualR,
      })),
    [expectedVsActual],
  );

  const valueFormatter = (v: number) =>
    mode === "dollar" ? currency(v) : mode === "r" ? `${v.toFixed(2)}R` : `${v.toFixed(1)}%`;

  const isComparison = mode === "comparison";
  // Explicit record type: the two branches have different shapes, and recharts
  // infers a single ChartData type from whichever branch it sees first.
  const chartData: Record<string, string | number>[] = isComparison ? comparisonChartData : valueChartData;
  // A single point can't draw a curve and collapses the Y axis to repeated
  // "0.0%" ticks — treat <2 points as empty.
  const isEmpty = chartData.length < 2;

  return (
    <div className="glass space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Equity Curve</h3>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            {(["percent", "r", "dollar", "comparison"] as const).map((m) => (
              <TabsTrigger key={m} value={m}>
                {MODE_LABEL[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isEmpty ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {isComparison
            ? "No planned trades with a confirmed plan in this range yet."
            : "No closed trades in this range yet."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="commandEquityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={isComparison ? 40 : 52}
              tickFormatter={(v: number) => (isComparison ? `${v.toFixed(0)}R` : valueFormatter(v))}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(value, name) => {
                if (isComparison) return [`${Number(value).toFixed(2)}R`, name === "expected" ? "Expected" : "Actual"];
                if (name === "underwater") return [valueFormatter(Number(value)), "Drawdown"];
                if (name === "value") return [valueFormatter(Number(value)), "Equity"];
                return [String(value), String(name)];
              }}
            />
            {isComparison ? (
              <>
                <Area
                  type="monotone"
                  dataKey="expected"
                  name="expected"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  fill="none"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="actual"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#commandEquityFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Legend
                  verticalAlign="top"
                  height={24}
                  iconType="plainline"
                  formatter={(value) => (
                    <span className="text-xs text-muted-foreground">
                      {value === "expected" ? "Expected R" : "Actual R"}
                    </span>
                  )}
                />
              </>
            ) : (
              <>
                <Area
                  type="monotone"
                  dataKey="value"
                  name="value"
                  stackId="equity"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#commandEquityFill)"
                  dot={{ r: 1.5, fill: "var(--chart-1)", strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="underwater"
                  name="underwater"
                  stackId="equity"
                  stroke="none"
                  fill="var(--danger)"
                  fillOpacity={0.12}
                  dot={false}
                  legendType="none"
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
