"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, ChartStat, ChartStatRow } from "@/components/viz/chart-card";
import { EquityInstrument, type EquityPoint } from "@/components/viz/equity-instrument";
import { formatDateRange, formatValue, type ValueUnit } from "@/components/viz/format";
import { annotateSeries } from "@/components/viz/series";
import { polarityOf } from "@/components/viz/tokens";
import type { EquityCurvePoint } from "@/domain/performance/rr";

/** Analytics V2 §4 — ONE Equity Curve with R / $ / % switching, reusing the
 *  three already-canonical series (never a fourth calculation):
 *   - R: the canonical, R-primary cumulative realized-R curve
 *     (analytics-canonical.service.ts's cumulativeRCurve) — pending trades
 *     never insert a fake result; a genuine breakeven still adds its real 0.
 *   - $: the Performance Account's running dollar balance, from the same
 *     per-trade series drawdown is computed from (analytics.service.ts).
 *   - %: the existing daily-return curve (compounding/additive sub-modes).
 *  Rendered by the shared EquityInstrument (baseline split, peak / max-DD
 *  markers, per-step tooltip, synced underwater pane). */
export function EquityCurveChart({
  data,
  rCurve = [],
  dollarCurve = [],
  startingBalance,
  drawdownPane = true,
}: {
  /** % daily-return curve (existing compounding/additive modes). */
  data: EquityCurvePoint[];
  /** Cumulative realized R, chronological — canonical-aggregations.ts's cumulativeRCurve.
   *  Optional: callers without the canonical dataset in scope (Dashboard,
   *  Accounts) simply don't offer the R/$ tabs, keeping the plain % chart
   *  they've always shown. `r` is the trade's own realized R when present. */
  rCurve?: { dateKey: string; cumulativeR: number; r?: number }[];
  /** Running Performance Account balance, one point per settled trade. Optional, same reasoning. */
  dollarCurve?: { dateKey: string; balance: number }[];
  /** The balance the $ curve starts from (its baseline). Defaults to the
   *  first point's balance when not supplied. */
  startingBalance?: number;
  drawdownPane?: boolean;
}) {
  const axes = [
    { key: "r" as const, label: "R", available: rCurve.length > 0 },
    { key: "dollar" as const, label: "$", available: dollarCurve.length > 0 },
    { key: "percent" as const, label: "%", available: true },
  ].filter((a) => a.available);

  const [axis, setAxis] = useState<"r" | "dollar" | "percent">(axes[0].key);
  const [percentMode, setPercentMode] = useState<"compounding" | "additive">("compounding");

  const unit: ValueUnit = axis === "r" ? "r" : axis === "dollar" ? "money" : "percent";
  const baseline = axis === "dollar" ? (startingBalance ?? dollarCurve[0]?.balance ?? 0) : 0;

  const points: EquityPoint[] = useMemo(
    () =>
      axis === "r"
        ? rCurve.map((d) => ({ x: d.dateKey, value: d.cumulativeR, stepValue: d.r }))
        : axis === "dollar"
          ? dollarCurve.map((d) => ({ x: d.dateKey, value: d.balance }))
          : data.map((d) => ({
              x: d.dateKey,
              value: percentMode === "compounding" ? d.cumulativeCompounding : d.cumulativeAdditive,
            })),
    [axis, rCurve, dollarCurve, data, percentMode],
  );

  const summary = useMemo(() => annotateSeries(points, baseline).summary, [points, baseline]);
  const lastFromPeak = summary ? Math.max(0, Math.max(summary.high.value, baseline) - summary.end) : 0;

  const actions = (
    <>
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
          <TabsList aria-label="Equity unit">
            {axes.map((a) => (
              <TabsTrigger key={a.key} value={a.key}>
                {a.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </>
  );

  return (
    <ChartCard
      title="Equity Curve"
      icon={TrendingUp}
      variant="primary"
      actions={actions}
      plotHeight={300}
      headline={
        summary && points.length >= 2
          ? {
              value: formatValue(summary.change, unit, { signed: true }),
              tone: polarityOf(summary.change),
              caption: `${formatDateRange(points[0].x, points[points.length - 1].x)} · ${points.length} ${axis === "percent" ? "days" : "trades"}`,
            }
          : undefined
      }
      empty={
        points.length < 2
          ? {
              title: points.length === 0 ? "No settled trades in this range yet" : "One settled trade so far",
              hint: points.length === 0 ? undefined : "The curve needs at least two points.",
            }
          : null
      }
      footer={
        summary && (
          <ChartStatRow>
            <ChartStat
              label={axis === "dollar" ? "Current balance" : "Current"}
              value={formatValue(summary.end, unit, { signed: axis !== "dollar" })}
              tone={axis === "dollar" ? polarityOf(summary.end - baseline) : polarityOf(summary.end)}
            />
            <ChartStat label="Period high" value={formatValue(summary.high.value, unit, { signed: axis !== "dollar" })} />
            <ChartStat
              label="Max drawdown"
              value={summary.maxDrawdown ? formatValue(-summary.maxDrawdown.amount, unit, { signed: true }) : "None"}
              tone={summary.maxDrawdown ? "loss" : undefined}
              hint="peak → trough in range"
            />
            <ChartStat
              label="From peak now"
              value={lastFromPeak > 0 ? formatValue(-lastFromPeak, unit, { signed: true }) : "At high"}
              tone={lastFromPeak > 0 ? "loss" : "profit"}
              hint={`${summary.ups} up · ${summary.downs} down`}
            />
          </ChartStatRow>
        )
      }
    >
      <EquityInstrument
        points={points}
        unit={unit}
        baseline={baseline}
        baselineLabel={axis === "dollar" ? "Start balance" : "Start"}
        valueLabel={axis === "r" ? "Cumulative R" : axis === "dollar" ? "Balance" : "Return"}
        stepLabel="Trade R"
        drawdownPane={drawdownPane}
      />
    </ChartCard>
  );
}
