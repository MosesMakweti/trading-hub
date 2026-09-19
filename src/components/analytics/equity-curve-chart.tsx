"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART_TOOLTIP_STYLE, CHART_AXIS_TICK } from "@/components/analytics/chart-theme";
import type { EquityCurvePoint } from "@/domain/performance/rr";

/** Analytics V2 §4 — ONE Equity Curve with R / $ / % switching, reusing the
 *  three already-canonical series (never a fourth calculation):
 *   - R: the canonical, R-primary cumulative realized-R curve
 *     (analytics-canonical.service.ts's cumulativeRCurve) — pending trades
 *     never insert a fake result; a genuine breakeven still adds its real 0.
 *   - $: the Performance Account's running dollar balance, from the same
 *     per-trade series drawdown is computed from (analytics.service.ts).
 *   - %: the existing daily-return curve (compounding/additive sub-modes).
 */
export function EquityCurveChart({
  data,
  rCurve = [],
  dollarCurve = [],
}: {
  /** % daily-return curve (existing compounding/additive modes). */
  data: EquityCurvePoint[];
  /** Cumulative realized R, chronological — canonical-aggregations.ts's cumulativeRCurve.
   *  Optional: callers without the canonical dataset in scope (Dashboard,
   *  Accounts) simply don't offer the R/$ tabs, keeping the plain % chart
   *  they've always shown. */
  rCurve?: { dateKey: string; cumulativeR: number }[];
  /** Running Performance Account balance, one point per settled trade. Optional, same reasoning. */
  dollarCurve?: { dateKey: string; balance: number }[];
}) {
  const axes = [
    { key: "r" as const, label: "R", available: rCurve.length > 0 },
    { key: "dollar" as const, label: "$", available: dollarCurve.length > 0 },
    { key: "percent" as const, label: "%", available: true },
  ].filter((a) => a.available);

  const [axis, setAxis] = useState<"r" | "dollar" | "percent">(axes[0].key);
  const [percentMode, setPercentMode] = useState<"compounding" | "additive">("compounding");

  const chartData =
    axis === "r"
      ? rCurve.map((d) => ({ date: d.dateKey, value: d.cumulativeR }))
      : axis === "dollar"
        ? dollarCurve.map((d) => ({ date: d.dateKey, value: d.balance }))
        : data.map((d) => ({
            date: d.dateKey,
            value: percentMode === "compounding" ? d.cumulativeCompounding : d.cumulativeAdditive,
          }));

  const formatValue = (v: number) =>
    axis === "r"
      ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`
      : axis === "dollar"
        ? v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
        : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Equity Curve</h3>
        <div className="flex flex-wrap items-center gap-2">
          {axis === "percent" && (
            <Tabs value={percentMode} onValueChange={(v) => setPercentMode(v as typeof percentMode)}>
              <TabsList>
                <TabsTrigger value="compounding">Compounding</TabsTrigger>
                <TabsTrigger value="additive">Additive</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {axes.length > 1 && (
            <Tabs value={axis} onValueChange={(v) => setAxis(v as typeof axis)}>
              <TabsList>
                {axes.map((a) => (
                  <TabsTrigger key={a.key} value={a.key}>
                    {a.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>
      {chartData.length < 2 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {chartData.length === 0
            ? "No settled trades in this range yet."
            : "Just one settled trade so far — the curve needs at least two points."}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={CHART_AXIS_TICK}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={axis === "dollar" ? 56 : 44}
              tickFormatter={(v: number) =>
                axis === "r" ? `${v}R` : axis === "dollar" ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}%`
              }
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => [formatValue(Number(value)), axis === "r" ? "Cumulative R" : axis === "dollar" ? "Balance" : "Return"]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#equityFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
