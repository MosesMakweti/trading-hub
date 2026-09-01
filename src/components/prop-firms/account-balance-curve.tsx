"use client";

import { useMemo, useState } from "react";
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
import { CHART_AXIS_TICK } from "@/components/analytics/chart-theme";
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

function makeFormatters(currency: string) {
  const full = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(undefined, {
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

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
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
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.01, 1);

  return (
    <div className={cn("glass space-y-3 rounded-2xl p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {subtitle}
            {fullSeries.hasData && (
              <>
                {" · "}
                <span className="tabular-nums">{fmt.money(fullSeries.currentBalance)}</span>
              </>
            )}
          </p>
        </div>
        {fullSeries.hasData && (
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

      {showSummary && summary && fullSeries.hasData && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryTile label="Starting balance" value={fmt.money(summary.startingBalance)} />
          <SummaryTile label="Current balance" value={fmt.money(summary.currentBalance)} />
          <SummaryTile
            label="Net trading P&L"
            value={fmt.signed(summary.netTradingPnl)}
            tone={summary.netTradingPnl > 0 ? "text-success" : summary.netTradingPnl < 0 ? "text-danger" : undefined}
          />
          <SummaryTile label="Peak balance" value={fmt.money(summary.peakBalance)} />
          <SummaryTile label="Total deposits" value={fmt.money(summary.totalDeposits)} />
          <SummaryTile label="Total withdrawals" value={fmt.money(summary.totalWithdrawals)} />
          <SummaryTile
            label="Max balance drawdown"
            value={
              summary.maxBalanceDrawdown > 0
                ? `−${fmt.money(summary.maxBalanceDrawdown)}${
                    summary.maxBalanceDrawdownPercent != null ? ` (${summary.maxBalanceDrawdownPercent.toFixed(1)}%)` : ""
                  }`
                : fmt.money(0)
            }
            tone={summary.maxBalanceDrawdown > 0 ? "text-danger" : undefined}
          />
          <SummaryTile label="Fees paid" value={fmt.money(summary.totalFees)} />
        </div>
      )}

      {!fullSeries.hasData || rows.length < 2 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No imported ledger activity yet — the balance curve appears once this account has transactions.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="acctBalanceCurveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="t"
              tick={CHART_AXIS_TICK}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={56}
              tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            />
            <YAxis
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
              domain={[min - pad, max + pad]}
              tickFormatter={(v: number) => fmt.axis(v)}
            />
            {startingBalance >= min - pad && startingBalance <= max + pad && (
              <ReferenceLine y={startingBalance} stroke="var(--border)" strokeDasharray="4 4" />
            )}
            {markersInView.map((m) => (
              <ReferenceLine
                key={`${m.at}-${m.label}`}
                x={m.at}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.5}
                strokeDasharray="2 4"
                label={{ value: m.label, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }}
              />
            ))}
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof rows)[number];
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-sm">
                    <div className="font-medium">{formatStamp(p.t)}</div>
                    <div className="mt-1 tabular-nums">Balance {fmt.money(p.balance)}</div>
                    {p.eventType !== "RANGE_OPENING" && (
                      <div className="tabular-nums text-muted-foreground">
                        {EVENT_LABELS[p.eventType] ?? p.eventType}
                        {p.change !== 0 && <> · {fmt.signed(p.change)}</>}
                      </div>
                    )}
                    {p.reference && <div className="text-muted-foreground">Ref {p.reference}</div>}
                    {p.reason && <div className="text-muted-foreground">{p.reason}</div>}
                  </div>
                );
              }}
            />
            <Area
              type="stepAfter"
              dataKey="balance"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              fill="url(#acctBalanceCurveFill)"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
