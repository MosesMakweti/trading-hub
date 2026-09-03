"use client";

import { useMemo, useState } from "react";
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
import { CHART_AXIS_TICK } from "@/components/analytics/chart-theme";
import { buildOverviewSeries, type OverviewAccountInput } from "@/domain/prop-firms/overview-series";

/**
 * Prop Firm Overview chart (spec §2) — weekly Master Account Capital + weekly
 * Cumulative Payouts, two independently-calculated series on independent Y
 * axes. All arithmetic is in domain/prop-firms/overview-series.ts; this
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

const CAPITAL_COLOR = "var(--chart-1)";
const PAYOUT_COLOR = "var(--success)";

function makeFmt(currency: string) {
  const full = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  return {
    money: (n: number) => full.format(n),
    axis: (n: number) => compact.format(n),
    signed: (n: number) => `${n >= 0 ? "+" : ""}${full.format(n)}`,
  };
}

function weekLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
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

  return (
    <div className={cn("glass space-y-3 rounded-2xl p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {subtitle} · {result.currency}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result.currencies.length > 1 && (
            <Tabs value={result.currency} onValueChange={(v) => v && setCurrency(v)}>
              <TabsList>
                {result.currencies.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <Tabs value={view} onValueChange={(v) => v && setView(v as SeriesView)}>
            <TabsList>
              <TabsTrigger value="both">Both</TabsTrigger>
              <TabsTrigger value="capital">Capital</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
            </TabsList>
          </Tabs>
          {!parentControlsRange && (
            <Tabs value={range} onValueChange={(v) => v && setRange(v as RangeKey)}>
              <TabsList>
                {RANGES.map((r) => (
                  <TabsTrigger key={r.value} value={r.value}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>

      {result.currencies.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Showing {result.currency}. Accounts in {result.currencies.filter((c) => c !== result.currency).join(", ")} are
          reported separately — unlike currencies are never added together.
        </p>
      )}

      {result.hasData && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="Opening master capital" value={fmt.money(s.openingMasterCapital)} />
          <SummaryTile label="Current master capital" value={fmt.money(s.currentMasterCapital)} />
          <SummaryTile
            label="Net capital change"
            value={fmt.signed(s.netMasterCapitalChange)}
            tone={s.netMasterCapitalChange > 0 ? "text-success" : s.netMasterCapitalChange < 0 ? "text-danger" : undefined}
          />
          <SummaryTile
            label="Capital growth"
            value={s.masterCapitalGrowthPercent == null ? "—" : `${s.masterCapitalGrowthPercent >= 0 ? "+" : ""}${s.masterCapitalGrowthPercent.toFixed(1)}%`}
            tone={
              s.masterCapitalGrowthPercent == null
                ? undefined
                : s.masterCapitalGrowthPercent > 0
                  ? "text-success"
                  : s.masterCapitalGrowthPercent < 0
                    ? "text-danger"
                    : undefined
            }
          />
          <SummaryTile label="Payouts in period" value={fmt.money(s.payoutsReceivedDuringPeriod)} />
          <SummaryTile label="Lifetime payouts" value={fmt.money(s.lifetimeCumulativePayouts)} />
        </div>
      )}

      {!result.hasData || rows.length < 2 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No funded-account history in range yet — this chart appears once a master/funded account has a couple of weeks
          of activity.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="pfOverviewCapital" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CAPITAL_COLOR} stopOpacity={0.14} />
                <stop offset="100%" stopColor={CAPITAL_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pfOverviewPayouts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PAYOUT_COLOR} stopOpacity={0.14} />
                <stop offset="100%" stopColor={PAYOUT_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="t"
              tick={CHART_AXIS_TICK}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={56}
              tickFormatter={weekLabel}
            />
            {showCapital && (
              <YAxis
                yAxisId="capital"
                tick={CHART_AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v: number) => fmt.axis(v)}
              />
            )}
            {showPayouts && (
              <YAxis
                yAxisId="payouts"
                orientation="right"
                tick={CHART_AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v: number) => fmt.axis(v)}
              />
            )}
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof rows)[number];
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
                    <div className="font-medium">
                      Week ending {new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    {showCapital && (
                      <div className="mt-1 tabular-nums">
                        <span className="inline-block size-2 rounded-full align-middle" style={{ background: CAPITAL_COLOR }} />{" "}
                        Master capital {fmt.money(p.masterCapital)}
                        <span className="text-muted-foreground"> · {p.activeAccountCount} acct{p.activeAccountCount === 1 ? "" : "s"}</span>
                      </div>
                    )}
                    {showPayouts && (
                      <div className="tabular-nums">
                        <span className="inline-block size-2 rounded-full align-middle" style={{ background: PAYOUT_COLOR }} />{" "}
                        Cumulative payouts {fmt.money(p.cumulativePayouts)}
                        {p.weeklyPayouts > 0 && <span className="text-muted-foreground"> · {fmt.signed(p.weeklyPayouts)} this week</span>}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {showCapital && (
              <Area
                yAxisId="capital"
                type="linear"
                dataKey="masterCapital"
                name="Master capital"
                stroke={CAPITAL_COLOR}
                strokeWidth={1.75}
                fill="url(#pfOverviewCapital)"
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            )}
            {showPayouts && (
              <Area
                yAxisId="payouts"
                type="linear"
                dataKey="cumulativePayouts"
                name="Cumulative payouts"
                stroke={PAYOUT_COLOR}
                strokeWidth={1.75}
                fill="url(#pfOverviewPayouts)"
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
