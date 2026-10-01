"use client";

import { BarChart3, Clock } from "lucide-react";

import { ChartCard } from "@/components/viz/chart-card";
import { ColumnChart, type Column } from "@/components/viz/column-chart";
import { formatMoney, formatR } from "@/components/viz/format";
import { polarityColor, VIZ } from "@/components/viz/tokens";

interface Bucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

/** Realized-R distribution — the shape of outcomes. Loss buckets in loss ink,
 *  gain buckets in profit ink; the tallest bucket is labelled; each column's
 *  tooltip gives its count, share of trades and R range. Buckets and counts
 *  are the canonical service's (distributionByRealizedR), unchanged. */
export function RDistributionCard({ buckets, expectancy }: { buckets: Bucket[]; expectancy: number | null }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const mode = Math.max(...buckets.map((b) => b.count));
  const losses = buckets.filter((b) => b.max <= 0).reduce((s, b) => s + b.count, 0);
  const gains = buckets.filter((b) => b.min >= 0).reduce((s, b) => s + b.count, 0);
  const columns: Column[] = buckets.map((b) => ({
    key: b.label,
    label: b.label,
    value: b.count,
    color: b.max <= 0 ? VIZ.loss : b.min >= 0 ? VIZ.profit : VIZ.neutral,
    showLabel: b.count === mode && mode > 0,
    tooltip: {
      title: b.label,
      subtitle: rangeText(b),
      rows: [
        { key: "n", label: "Trades", value: String(b.count), color: b.max <= 0 ? VIZ.loss : VIZ.profit, mark: "swatch" },
        { key: "s", label: "Share of settled", value: total > 0 ? `${((b.count / total) * 100).toFixed(0)}%` : "—", mark: "none" },
      ],
    },
  }));
  return (
    <ChartCard
      title="Realized R distribution"
      icon={BarChart3}
      hint="settled trades by realized R-multiple"
      headline={total > 0 ? { value: `${gains} gains · ${losses} losses`, caption: `expectancy ${formatR(expectancy)}` } : undefined}
      plotHeight={200}
      empty={total === 0 ? { title: "No settled trades in this range yet" } : null}
    >
      <ColumnChart columns={columns} ariaLabel={`Realized R distribution across ${total} settled trades`} />
    </ChartCard>
  );
}

function rangeText(b: Bucket): string {
  if (!Number.isFinite(b.min)) return `below ${formatR(b.max, 0)}`;
  if (!Number.isFinite(b.max)) return `${formatR(b.min, 0)} and above`;
  return `${formatR(b.min, 0)} to ${formatR(b.max, 0)} (upper bound excluded)`;
}

interface HourPerf {
  hour: number;
  trades: number;
  netPnl: number;
  winRate: number | null;
  avgR: number | null;
  expectancy: number | null;
}

/** Trades by hour of day — column height is activity (trade count), the tint
 *  is that hour's net P&L sign, so "when do I trade" and "when does it pay"
 *  read together. The busiest hour is labelled. */
export function HoursCard({ hours }: { hours: HourPerf[] }) {
  const busiest = Math.max(...hours.map((h) => h.trades));
  const best = hours.reduce((a, h) => (h.netPnl > a.netPnl ? h : a), hours[0]);
  const worst = hours.reduce((a, h) => (h.netPnl < a.netPnl ? h : a), hours[0]);
  const columns: Column[] = hours.map((h) => ({
    key: String(h.hour),
    label: `${String(h.hour).padStart(2, "0")}h`,
    value: h.trades,
    color: polarityColor(h.netPnl),
    showLabel: h.trades === busiest,
    tooltip: {
      title: `${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour).padStart(2, "0")}:59`,
      rows: [
        { key: "n", label: "Trades", value: String(h.trades), color: polarityColor(h.netPnl), mark: "swatch" },
        { key: "p", label: "Net P&L", value: formatMoney(h.netPnl, { signed: true }), tone: h.netPnl > 0 ? "profit" : h.netPnl < 0 ? "loss" : "muted", mark: "none" },
        { key: "w", label: "Win rate", value: h.winRate != null ? `${h.winRate.toFixed(0)}%` : "—", mark: "none" },
        { key: "a", label: "Average R", value: formatR(h.avgR), mark: "none" },
      ],
    },
  }));
  return (
    <ChartCard
      title="Trades by hour of day"
      icon={Clock}
      hint="height = trades · tint = net P&L sign"
      headline={{
        value: `${String(best.hour).padStart(2, "0")}h best`,
        caption: `${formatMoney(best.netPnl, { signed: true })} · weakest ${String(worst.hour).padStart(2, "0")}h ${formatMoney(worst.netPnl, { signed: true })}`,
      }}
    >
      <ColumnChart columns={columns} ariaLabel="Trades by hour of day, coloured by net P&L" />
    </ChartCard>
  );
}
