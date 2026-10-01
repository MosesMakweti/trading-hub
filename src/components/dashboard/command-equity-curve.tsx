"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, ChartStat, ChartStatRow } from "@/components/viz/chart-card";
import { ChartLegend } from "@/components/viz/chart-legend";
import { EquityInstrument, type EquityPoint } from "@/components/viz/equity-instrument";
import { formatDateRange, formatValue, type ValueUnit } from "@/components/viz/format";
import { annotateSeries } from "@/components/viz/series";
import { polarityOf, VIZ } from "@/components/viz/tokens";
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

/**
 * Command-center equity curve: %/R/$ value modes (all three derived from the
 * SAME real Performance-Account $ P&L pipeline `analytics.service.ts` already
 * builds — "R" here is the app's existing additive-return convention, matching
 * how Expectancy/Profit-Factor are already labeled elsewhere, not a second,
 * separately-computed R-multiple system) plus an Expected-vs-Actual R
 * comparison mode built from each trade's real `expectedRR`/`actualRR`.
 * Rendered by the shared EquityInstrument — the series mapping below is
 * unchanged; only the presentation moved to the viz kit.
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
  const isComparison = mode === "comparison";

  const unit: ValueUnit = mode === "dollar" ? "money" : mode === "percent" ? "percent" : "r";
  const baseline = mode === "dollar" ? startingBalance : 0;

  const points: EquityPoint[] = useMemo(() => {
    if (isComparison) return expectedVsActual.map((p) => ({ x: p.dateKey, value: p.cumulativeActualR }));
    return data.map((d) => ({
      x: d.dateKey,
      value:
        mode === "dollar"
          ? startingBalance * (1 + d.cumulativeCompounding / 100)
          : mode === "r"
            ? d.cumulativeAdditive
            : d.cumulativeCompounding,
    }));
  }, [data, mode, startingBalance, expectedVsActual, isComparison]);

  const reference = useMemo(
    () => (isComparison ? { label: "Expected R", values: expectedVsActual.map((p) => p.cumulativeExpectedR) } : undefined),
    [isComparison, expectedVsActual],
  );

  const summary = useMemo(() => annotateSeries(points, baseline).summary, [points, baseline]);
  const isEmpty = points.length < 2;
  const lastExpected = isComparison ? expectedVsActual[expectedVsActual.length - 1]?.cumulativeExpectedR : undefined;

  return (
    <ChartCard
      title="Equity Curve"
      icon={TrendingUp}
      plotHeight={280}
      actions={
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList aria-label="Equity mode">
            {(["percent", "r", "dollar", "comparison"] as const).map((m) => (
              <TabsTrigger key={m} value={m}>
                {MODE_LABEL[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      headline={
        summary && !isEmpty
          ? {
              value: formatValue(summary.change, unit, { signed: true }),
              tone: polarityOf(summary.change),
              caption: formatDateRange(points[0].x, points[points.length - 1].x),
            }
          : undefined
      }
      legend={
        isComparison ? (
          <ChartLegend
            items={[
              { key: "actual", label: "Actual R", color: summary && summary.end < 0 ? VIZ.loss : VIZ.profit, mark: "line" },
              { key: "expected", label: "Expected R", color: VIZ.reference, mark: "dash" },
            ]}
          />
        ) : undefined
      }
      empty={
        isEmpty
          ? {
              title: isComparison
                ? "No planned trades with a confirmed plan in this range yet"
                : "No closed trades in this range yet",
            }
          : null
      }
      footer={
        summary && (
          <ChartStatRow cols={3}>
            {isComparison && lastExpected != null ? (
              <>
                <ChartStat label="Actual" value={formatValue(summary.end, "r", { signed: true })} tone={polarityOf(summary.end)} />
                <ChartStat label="Expected" value={formatValue(lastExpected, "r", { signed: true })} />
                <ChartStat
                  label="Gap"
                  value={formatValue(summary.end - lastExpected, "r", { signed: true })}
                  tone={polarityOf(summary.end - lastExpected)}
                  hint="actual − expected"
                />
              </>
            ) : (
              <>
                <ChartStat label="Period high" value={formatValue(summary.high.value, unit, { signed: unit !== "money" })} />
                <ChartStat
                  label="Max drawdown"
                  value={summary.maxDrawdown ? formatValue(-summary.maxDrawdown.amount, unit, { signed: true }) : "None"}
                  tone={summary.maxDrawdown ? "loss" : undefined}
                />
                <ChartStat label="Up / down" value={`${summary.ups} / ${summary.downs}`} hint={mode === "percent" || mode === "r" || mode === "dollar" ? "days" : undefined} />
              </>
            )}
          </ChartStatRow>
        )
      }
    >
      <EquityInstrument
        points={points}
        unit={unit}
        baseline={baseline}
        baselineLabel={mode === "dollar" ? "Start balance" : "Start"}
        valueLabel={isComparison ? "Actual R" : mode === "dollar" ? "Balance" : mode === "r" ? "Cumulative R" : "Return"}
        reference={reference}
        height={260}
      />
    </ChartCard>
  );
}
