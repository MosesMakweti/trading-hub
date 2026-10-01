"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, ChartStat, ChartStatRow } from "@/components/viz/chart-card";
import { ChartLegend } from "@/components/viz/chart-legend";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { niceTicks } from "@/components/viz/series";
import { CHART, SERIES, VIZ } from "@/components/viz/tokens";
import { buildOverviewSeries, type OverviewAccountInput } from "@/domain/prop-firms/overview-series";

/**
 * Prop Firm Overview chart (spec §2) — weekly Master Account Capital + weekly
 * Cumulative Payouts, two independently-calculated series — drawn as two
 * crosshair-synced panes, each on its own axis (not a dual-axis chart). All arithmetic is in domain/prop-firms/overview-series.ts; this
 * component only builds the series from prepared inputs and draws it.
 * (`buildOverviewAccountInputs` lives in that domain module too, so server
 * page components can prepare the input.)
 */

type SeriesView = "both" | "capital" | "payouts";
type RangeKey = "3M" | "6M" | "1Y" | "ALL";
const RANGES: { value: RangeKey; label: string; months: number | null }[] = [
  { value: "3M", label: "3M", months: 3 },
  { value: "6M", label: "6M", months: 6 },
  { value: "1Y", label: "1Y", months: 12 },
  { value: "ALL", label: "All", months: null },
];

// Identity slots 1 + 2 (a validated adjacent pair). Payouts are a dataset,
// not a profit signal, so they take an identity hue rather than success green.
const CAPITAL_COLOR = SERIES[0];
const PAYOUT_COLOR = SERIES[1];

function makeFmt(currency: string) {
  // en-US pinned: the runtime default differs server vs browser (hydration mismatch).
  const full = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  return {
    money: (n: number) => full.format(n),
    axis: (n: number) => compact.format(n),
    signed: (n: number) => `${n >= 0 ? "+" : ""}${full.format(n)}`,
  };
}

function weekLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PropFirmOverviewChart({
  accounts,
  from,
  to,
  title = "Master capital & payouts",
  subtitle = "Weekly combined funded-account capital and cumulative payouts",
  height = 260,
  className,
}: {
  accounts: OverviewAccountInput[];
  /** When provided, the parent's date filter drives the window and the local
   *  range toggle is hidden. */
  from?: string | null;
  to?: string | null;
  title?: string;
  subtitle?: string;
  height?: number;
  className?: string;
}) {
  const parentControlsRange = from !== undefined || to !== undefined;
  const [range, setRange] = useState<RangeKey>("ALL");
  const [view, setView] = useState<SeriesView>("both");
  const [currency, setCurrency] = useState<string | undefined>(undefined);

  const effectiveFrom = useMemo(() => {
    if (parentControlsRange) return from ?? null;
    const months = RANGES.find((r) => r.value === range)?.months ?? null;
    if (months == null) return null;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString();
  }, [parentControlsRange, from, range]);

  const result = useMemo(
    () => buildOverviewSeries(accounts, { from: effectiveFrom, to: parentControlsRange ? (to ?? null) : null, currency }),
    [accounts, effectiveFrom, to, parentControlsRange, currency],
  );

  const fmt = useMemo(() => makeFmt(result.currency), [result.currency]);
  const showCapital = view !== "payouts";
  const showPayouts = view !== "capital";

  const rows = useMemo(
    () =>
      result.points.map((p) => ({
        t: p.weekEnding,
        masterCapital: p.masterCapital,
        cumulativePayouts: p.cumulativePayouts,
        weeklyPayouts: p.weeklyPayouts,
        activeAccountCount: p.activeAccountCount,
      })),
    [result.points],
  );

  const s = result.summary;
  const uid = useId().replace(/:/g, "");
  const syncId = `pfo-${uid}`;
  const both = showCapital && showPayouts;
  const capitalY = useMemo(() => {
    const v = rows.map((r) => r.masterCapital);
    return niceTicks(Math.min(...v, 0), Math.max(...v, 1), 4);
  }, [rows]);
  const payoutY = useMemo(() => niceTicks(0, Math.max(1, ...rows.map((r) => r.cumulativePayouts)), 4), [rows]);

  const tooltip = rechartsTooltip<(typeof rows)[number]>((p) => ({
    title: `Week ending ${new Date(p.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    subtitle: `${p.activeAccountCount} active account${p.activeAccountCount === 1 ? "" : "s"}`,
    rows: [
      ...(showCapital ? [{ key: "cap", label: "Master capital", value: fmt.money(p.masterCapital), color: CAPITAL_COLOR }] : []),
      ...(showPayouts
        ? [
            { key: "pay", label: "Cumulative payouts", value: fmt.money(p.cumulativePayouts), color: PAYOUT_COLOR },
            ...(p.weeklyPayouts > 0
              ? [{ key: "wk", label: "Paid this week", value: fmt.signed(p.weeklyPayouts), tone: "profit" as const, mark: "none" as const, separated: true }]
              : []),
          ]
        : []),
    ],
  }));

  const xAxis = (hide: boolean) => (
    <XAxis dataKey="t" tick={CHART.tick} {...CHART.xAxis} minTickGap={56} tickFormatter={weekLabel} hide={hide} />
  );

  return (
    <ChartCard
      title={title}
      hint={`${subtitle} · ${result.currency}`}
      className={className}
      plotHeight={height}
      headline={
        result.hasData
          ? {
              value: fmt.money(s.currentMasterCapital),
              caption: (
                <span className={cn("tabular-nums", s.netMasterCapitalChange > 0 ? "text-success" : s.netMasterCapitalChange < 0 ? "text-danger" : undefined)}>
                  {fmt.signed(s.netMasterCapitalChange)} capital in period
                </span>
              ),
            }
          : undefined
      }
      actions={
        <>
          {result.currencies.length > 1 && (
            <Tabs value={result.currency} onValueChange={(v) => v && setCurrency(v)}>
              <TabsList aria-label="Currency">
                {result.currencies.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <Tabs value={view} onValueChange={(v) => v && setView(v as SeriesView)}>
            <TabsList aria-label="Series">
              <TabsTrigger value="both">Both</TabsTrigger>
              <TabsTrigger value="capital">Capital</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </TabsList>
          </Tabs>
          {!parentControlsRange && (
            <Tabs value={range} onValueChange={(v) => v && setRange(v as RangeKey)}>
              <TabsList aria-label="Range">
                {RANGES.map((r) => (
                  <TabsTrigger key={r.value} value={r.value}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </>
      }
      legend={
        both ? (
          <ChartLegend
            items={[
              { key: "cap", label: "Master capital", color: CAPITAL_COLOR, mark: "line", value: fmt.money(s.currentMasterCapital) },
              { key: "pay", label: "Cumulative payouts", color: PAYOUT_COLOR, mark: "line", value: fmt.money(s.lifetimeCumulativePayouts) },
            ]}
          />
        ) : undefined
      }
      empty={
        !result.hasData || rows.length < 2
          ? {
              title: "No funded-account history in range yet",
              hint: "This chart appears once a master/funded account has a couple of weeks of activity.",
            }
          : null
      }
      footer={
        result.hasData && (
          <ChartStatRow className="lg:grid-cols-6">
            <ChartStat label="Opening master capital" value={fmt.money(s.openingMasterCapital)} />
            <ChartStat label="Current master capital" value={fmt.money(s.currentMasterCapital)} />
            <ChartStat
              label="Net capital change"
              value={fmt.signed(s.netMasterCapitalChange)}
              tone={s.netMasterCapitalChange > 0 ? "profit" : s.netMasterCapitalChange < 0 ? "loss" : undefined}
            />
            <ChartStat
              label="Capital growth"
              value={s.masterCapitalGrowthPercent == null ? "—" : `${s.masterCapitalGrowthPercent >= 0 ? "+" : ""}${s.masterCapitalGrowthPercent.toFixed(1)}%`}
              tone={
                s.masterCapitalGrowthPercent == null ? undefined : s.masterCapitalGrowthPercent > 0 ? "profit" : s.masterCapitalGrowthPercent < 0 ? "loss" : undefined
              }
            />
            <ChartStat label="Payouts in period" value={fmt.money(s.payoutsReceivedDuringPeriod)} />
            <ChartStat label="Lifetime payouts" value={fmt.money(s.lifetimeCumulativePayouts)} />
          </ChartStatRow>
        )
      }
    >
      {result.currencies.length > 1 && (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing {result.currency}. Accounts in {result.currencies.filter((c) => c !== result.currency).join(", ")} are
          reported separately — unlike currencies are never added together.
        </p>
      )}
      {/* Two measures of different scale → two synced panes, each on its own
          axis (never a dual-y chart — design-system §10). */}
      <div className="space-y-1">
        {showCapital && (
          <div>
            {both && <PaneLabel color={CAPITAL_COLOR} label="Master capital" />}
            <ResponsiveContainer width="100%" height={both ? Math.round(height * 0.62) : height}>
              <AreaChart data={rows} syncId={syncId} margin={{ ...CHART.margin, right: 20 }}>
                <defs>
                  <linearGradient id={`${uid}-cap`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CAPITAL_COLOR} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={CAPITAL_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART.grid} />
                {xAxis(both)}
                <YAxis tick={CHART.tick} {...CHART.yAxis} width={64} domain={capitalY.domain} ticks={capitalY.ticks} tickFormatter={(v: number) => fmt.axis(v)} />
                <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
                <Area
                  type="linear"
                  dataKey="masterCapital"
                  name="Master capital"
                  stroke={CAPITAL_COLOR}
                  strokeWidth={CHART.lineWidth}
                  fill={`url(#${uid}-cap)`}
                  dot={false}
                  activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2, fill: CAPITAL_COLOR }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {showPayouts && (
          <div>
            {both && <PaneLabel color={PAYOUT_COLOR} label="Cumulative payouts" />}
            <ResponsiveContainer width="100%" height={both ? Math.round(height * 0.38) + 24 : height}>
              <AreaChart data={rows} syncId={syncId} margin={{ ...CHART.margin, right: 20 }}>
                <defs>
                  <linearGradient id={`${uid}-pay`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PAYOUT_COLOR} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={PAYOUT_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART.grid} />
                {xAxis(false)}
                <YAxis tick={CHART.tick} {...CHART.yAxis} width={64} domain={payoutY.domain} ticks={payoutY.ticks} tickFormatter={(v: number) => fmt.axis(v)} />
                <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
                <Area
                  type="stepAfter"
                  dataKey="cumulativePayouts"
                  name="Cumulative payouts"
                  stroke={PAYOUT_COLOR}
                  strokeWidth={CHART.lineWidth}
                  fill={`url(#${uid}-pay)`}
                  dot={(props: { cx?: number; cy?: number; index?: number }) => {
                    const r = props.index != null ? rows[props.index] : undefined;
                    if (!r || r.weeklyPayouts <= 0 || props.cx == null || props.cy == null) return <g key={`d-${props.index}`} />;
                    return <circle key={`d-${props.index}`} cx={props.cx} cy={props.cy} r={4} fill={PAYOUT_COLOR} stroke={VIZ.surface} strokeWidth={2} />;
                  }}
                  activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2, fill: PAYOUT_COLOR }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

function PaneLabel({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
      <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}
