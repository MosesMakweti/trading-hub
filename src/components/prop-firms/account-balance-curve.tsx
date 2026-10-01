"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, ChartStat, ChartStatRow } from "@/components/viz/chart-card";
import { rechartsTooltip } from "@/components/viz/chart-tooltip";
import { baselineOffset, niceTicks } from "@/components/viz/series";
import { CHART, VIZ } from "@/components/viz/tokens";
import {
  buildAccountBalanceSeries,
  downsampleBalancePoints,
  sliceBalanceSeriesToRange,
  summariseAccountBalance,
  type RawBalanceEvent,
} from "@/domain/prop-firms/balance-curve";
import type { LedgerEntryDTO } from "@/types/prop-firms";

/** Adapt the account ledger DTO stream into balance-curve input. The stored
 *  `balanceAfter` is intentionally dropped — the curve re-derives balance from
 *  `startingBalance` + signed amounts (see balance-curve.ts). */
export function ledgerEntriesToBalanceEvents(ledger: LedgerEntryDTO[]): RawBalanceEvent[] {
  return ledger.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    amount: e.amount,
    occurredAt: e.occurredAt,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    reason: e.reason,
  }));
}

/**
 * Progressive Account Balance Curve (spec §1) — the real running balance of a
 * single prop-firm account from its imported ledger events. NOT a P&L curve
 * and deliberately not titled "Equity curve": it contains closed-balance data
 * only. All arithmetic lives in domain/prop-firms/balance-curve.ts; this
 * component only prepares already-computed points for recharts.
 */

const EVENT_LABELS: Record<string, string> = {
  ACCOUNT_INITIALIZED: "Account opened",
  RANGE_OPENING: "Opening balance",
  TRADE_PNL: "Trade result",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  CUSTOM_ADJUSTMENT: "Adjustment",
  COMMISSION_FEE: "Commission",
  CHALLENGE_PURCHASE_FEE: "Challenge fee",
  RESET_FEE: "Reset fee",
  ACTIVATION_FEE: "Activation fee",
  OTHER_FEE: "Fee",
  PAYOUT: "Payout",
  WITHDRAWAL: "Withdrawal",
  DEPOSIT: "Deposit",
  CREDIT: "Credit",
  REFUND: "Refund",
  BALANCE_CORRECTION: "Balance correction",
  STAGE_PASSED: "Stage passed",
  STAGE_FAILED: "Stage failed",
  ACCOUNT_BREACHED: "Account breached",
  STAGE_STARTING_BALANCE_RESET: "Starting balance reset",
};

type RangeKey = "1M" | "3M" | "1Y" | "ALL";
const RANGES: { value: RangeKey; label: string; months: number | null }[] = [
  { value: "1M", label: "1M", months: 1 },
  { value: "3M", label: "3M", months: 3 },
  { value: "1Y", label: "1Y", months: 12 },
  { value: "ALL", label: "All", months: null },
];

// Pinned to en-US (like the rest of the app's money formatting): the runtime
// default locale differs between the server and the viewer's browser, which
// rendered "$54,432.00" on the server and "US$54,432.00" in an en-GB browser —
// a hydration mismatch on every SSR'd figure.
function makeFormatters(currency: string) {
  const full = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    money: (n: number) => full.format(n),
    axis: (n: number) => compact.format(n),
    signed: (n: number) => `${n >= 0 ? "+" : ""}${full.format(n)}`,
  };
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function AccountBalanceCurve({
  events,
  startingBalance,
  accountCurrency = "USD",
  stageMarkers = [],
  height = 240,
  title = "Account Balance Curve",
  subtitle = "Progressive balance from imported ledger activity",
  showSummary = true,
  className,
}: {
  events: RawBalanceEvent[];
  startingBalance: number;
  accountCurrency?: string;
  stageMarkers?: { at: string; label: string }[];
  height?: number;
  title?: string;
  subtitle?: string;
  showSummary?: boolean;
  className?: string;
}) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const fmt = useMemo(() => makeFormatters(accountCurrency), [accountCurrency]);

  const fullSeries = useMemo(
    () => buildAccountBalanceSeries(events, startingBalance),
    [events, startingBalance],
  );
  const summary = useMemo(
    () => (showSummary ? summariseAccountBalance(events, startingBalance) : null),
    [events, startingBalance, showSummary],
  );

  const view = useMemo(() => {
    const months = RANGES.find((r) => r.value === range)?.months ?? null;
    if (months == null || fullSeries.points.length === 0) return fullSeries;
    const lastTs = fullSeries.points[fullSeries.points.length - 1].timestamp;
    const from = new Date(lastTs);
    from.setMonth(from.getMonth() - months);
    return sliceBalanceSeriesToRange(fullSeries, from.toISOString(), null);
  }, [fullSeries, range]);

  const rows = useMemo(
    () =>
      downsampleBalancePoints(view.points).map((p) => ({
        t: p.timestamp,
        balance: p.balance,
        change: p.change,
        eventType: p.eventType,
        reference: p.reference,
        reason: p.reason,
      })),
    [view.points],
  );

  const markersInView = useMemo(() => {
    if (view.points.length === 0) return [];
    const first = view.points[0].timestamp;
    const last = view.points[view.points.length - 1].timestamp;
    return stageMarkers.filter((m) => m.at >= first && m.at <= last);
  }, [stageMarkers, view.points]);

  const balances = rows.map((r) => r.balance);
  const min = balances.length ? Math.min(...balances) : 0;
  const max = balances.length ? Math.max(...balances) : 0;
  const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.005, 1);
  const y = niceTicks(Math.min(min - pad, startingBalance), Math.max(max + pad, startingBalance), 5);
  // Split colour at the starting balance — gradient offsets are relative to
  // each path's own bounding box (line: its values; area: values + baseline).
  const strokeOffset = baselineOffset(min, max, startingBalance);
  const fillOffset = baselineOffset(Math.min(min, startingBalance), Math.max(max, startingBalance), startingBalance);
  const vsStart = fullSeries.hasData ? fullSeries.currentBalance - startingBalance : 0;
  const uid = useId().replace(/:/g, "");

  const tooltip = rechartsTooltip<(typeof rows)[number]>((p) => ({
    title: formatStamp(p.t),
    subtitle: p.eventType !== "RANGE_OPENING" ? (EVENT_LABELS[p.eventType] ?? p.eventType) : "Opening balance in view",
    rows: [
      { key: "bal", label: "Balance", value: fmt.money(p.balance), color: p.balance < startingBalance ? VIZ.loss : VIZ.profit },
      ...(p.eventType !== "RANGE_OPENING" && p.change !== 0
        ? [{ key: "chg", label: "Change", value: fmt.signed(p.change), tone: p.change > 0 ? ("profit" as const) : ("loss" as const), mark: "none" as const }]
        : []),
      {
        key: "vs",
        label: "vs starting balance",
        value: fmt.signed(p.balance - startingBalance),
        tone: p.balance > startingBalance ? ("profit" as const) : p.balance < startingBalance ? ("loss" as const) : ("muted" as const),
        mark: "none" as const,
        separated: true,
      },
    ],
    footer: p.reference || p.reason ? [p.reference && `Ref ${p.reference}`, p.reason].filter(Boolean).join(" · ") : undefined,
  }));

  return (
    <ChartCard
      title={title}
      hint={subtitle}
      className={className}
      plotHeight={height}
      headline={
        fullSeries.hasData
          ? {
              value: fmt.money(fullSeries.currentBalance),
              caption: (
                <span className={cn("tabular-nums", vsStart > 0 ? "text-success" : vsStart < 0 ? "text-danger" : undefined)}>
                  {fmt.signed(vsStart)} vs start
                </span>
              ),
            }
          : undefined
      }
      actions={
        fullSeries.hasData && (
          <Tabs value={range} onValueChange={(v) => v && setRange(v as RangeKey)}>
            <TabsList aria-label="Balance range">
              {RANGES.map((r) => (
                <TabsTrigger key={r.value} value={r.value}>
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )
      }
      empty={
        !fullSeries.hasData || rows.length < 2
          ? { title: "No imported ledger activity yet", hint: "The balance curve appears once this account has transactions." }
          : null
      }
      footer={
        showSummary &&
        summary &&
        fullSeries.hasData && (
          <ChartStatRow>
            <ChartStat label="Starting balance" value={fmt.money(summary.startingBalance)} />
            <ChartStat label="Peak balance" value={fmt.money(summary.peakBalance)} />
            <ChartStat
              label="Net trading P&L"
              value={fmt.signed(summary.netTradingPnl)}
              tone={summary.netTradingPnl > 0 ? "profit" : summary.netTradingPnl < 0 ? "loss" : undefined}
            />
            <ChartStat
              label="Max balance drawdown"
              value={summary.maxBalanceDrawdown > 0 ? `−${fmt.money(summary.maxBalanceDrawdown)}` : fmt.money(0)}
              hint={summary.maxBalanceDrawdownPercent != null && summary.maxBalanceDrawdown > 0 ? `${summary.maxBalanceDrawdownPercent.toFixed(1)}% from peak` : undefined}
              tone={summary.maxBalanceDrawdown > 0 ? "loss" : undefined}
            />
            <ChartStat label="Total deposits" value={fmt.money(summary.totalDeposits)} />
            <ChartStat label="Total withdrawals" value={fmt.money(summary.totalWithdrawals)} />
            <ChartStat label="Fees paid" value={fmt.money(summary.totalFees)} />
            <ChartStat label="Current balance" value={fmt.money(summary.currentBalance)} />
          </ChartStatRow>
        )
      }
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ ...CHART.margin, right: 20, top: 12 }}>
          <defs>
            <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={strokeOffset} stopColor={VIZ.profit} />
              <stop offset={strokeOffset} stopColor={VIZ.loss} />
            </linearGradient>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={VIZ.profit} stopOpacity={0.18} />
              <stop offset={fillOffset} stopColor={VIZ.profit} stopOpacity={0.03} />
              <stop offset={fillOffset} stopColor={VIZ.loss} stopOpacity={0.03} />
              <stop offset={1} stopColor={VIZ.loss} stopOpacity={0.18} />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART.grid} />
          <XAxis
            dataKey="t"
            tick={CHART.tick}
            {...CHART.xAxis}
            minTickGap={56}
            tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          />
          <YAxis
            tick={CHART.tick}
            {...CHART.yAxis}
            width={64}
            domain={y.domain}
            ticks={y.ticks}
            tickFormatter={(v: number) => fmt.axis(v)}
          />
          <ReferenceLine
            y={startingBalance}
            stroke={VIZ.axis}
            label={{ value: "Start", position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 10 }}
          />
          {markersInView.map((m) => (
            <ReferenceLine
              key={`${m.at}-${m.label}`}
              x={m.at}
              stroke={VIZ.reference}
              strokeOpacity={0.7}
              strokeDasharray={CHART.referenceDash}
              label={{ value: m.label, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }}
            />
          ))}
          <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
          <Area
            type="stepAfter"
            dataKey="balance"
            baseValue={startingBalance}
            stroke={`url(#${uid}-stroke)`}
            strokeWidth={CHART.lineWidth}
            fill={`url(#${uid}-fill)`}
            dot={false}
            activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2, fill: vsStart < 0 ? VIZ.loss : VIZ.profit }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
