import { LineChart } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { CountUp, type CountUpConfig } from "@/components/analytics/count-up";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { accountRoiPercent, type AggregateMetrics } from "@/domain/prop-firms/metrics";
import type { OverviewAccountInput } from "@/domain/prop-firms/overview-series";
import { PropFirmOverviewChart } from "@/components/prop-firms/prop-firm-overview-chart";
import type { UserPropFirmDTO } from "@/types/prop-firms";

function formatPercent(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function countOf(v: number | null, config: Omit<CountUpConfig, "value">): CountUpConfig | undefined {
  return v == null ? undefined : { value: v, ...config };
}

export function PerformanceTab({
  firm,
  metrics,
  overviewAccounts,
}: {
  firm: UserPropFirmDTO;
  metrics: AggregateMetrics;
  overviewAccounts: OverviewAccountInput[];
}) {
  if (firm.accounts.length === 0) {
    return (
      <EmptyState
        icon={LineChart}
        title="No performance data yet"
        description="Once accounts are purchased and trading begins, per-account performance will show up here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <PropFirmOverviewChart
        accounts={overviewAccounts}
        title="Master capital & payouts"
        subtitle={`Weekly funded-account capital and cumulative payouts · ${firm.companyName}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat
          label="Net trading P&L"
          value={formatSignedCurrency(metrics.netTradingPnl)}
          count={countOf(metrics.netTradingPnl, { decimals: 2, prefix: "$", grouping: true, signed: true })}
          tone={metrics.netTradingPnl > 0 ? "text-success" : metrics.netTradingPnl < 0 ? "text-danger" : undefined}
        />
        <SummaryStat
          label="Account ROI"
          value={formatPercent(metrics.accountRoiPercent)}
          count={countOf(metrics.accountRoiPercent, { decimals: 1, suffix: "%", signed: true })}
          tone={
            metrics.accountRoiPercent == null
              ? undefined
              : metrics.accountRoiPercent > 0
                ? "text-success"
                : metrics.accountRoiPercent < 0
                  ? "text-danger"
                  : undefined
          }
        />
        <SummaryStat
          label="Investment ROI"
          value={formatPercent(metrics.traderInvestmentRoiPercent)}
          count={countOf(metrics.traderInvestmentRoiPercent, { decimals: 1, suffix: "%", signed: true })}
          tone={
            metrics.traderInvestmentRoiPercent == null
              ? undefined
              : metrics.traderInvestmentRoiPercent > 0
                ? "text-success"
                : metrics.traderInvestmentRoiPercent < 0
                  ? "text-danger"
                  : undefined
          }
        />
        <SummaryStat
          label="Net profit"
          value={formatSignedCurrency(metrics.netPropFirmProfit)}
          count={countOf(metrics.netPropFirmProfit, { decimals: 2, prefix: "$", grouping: true, signed: true })}
          tone={metrics.netPropFirmProfit > 0 ? "text-success" : metrics.netPropFirmProfit < 0 ? "text-danger" : undefined}
        />
      </div>

      <div className="space-y-2">
        {firm.accounts.map((a) => {
          const pnl = a.currentBalance != null ? a.currentBalance - a.startingBalance : null;
          const roi = pnl != null ? accountRoiPercent(pnl, a.startingBalance) : null;
          const ratio =
            a.currentBalance != null && a.startingBalance > 0
              ? Math.max(0, Math.min(1, a.currentBalance / (a.startingBalance * 1.2)))
              : null;
          return (
            <div key={a.id} className="glass rounded-xl p-3.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{a.displayName}</span>
                <span className={roi == null || roi === 0 ? "text-muted-foreground" : roi > 0 ? "text-success" : "text-danger"}>
                  {pnl != null ? formatSignedCurrency(pnl) : "—"} ({formatPercent(roi)})
                </span>
              </div>
              {ratio != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${pnl != null && pnl >= 0 ? "bg-success/60" : "bg-danger/60"}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Profit-target and drawdown-room tracking require the live rule-evaluation engine, which isn&apos;t enabled yet —
        the figures above use only stored balances and payouts.
      </p>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  count,
  tone,
}: {
  label: string;
  value: string;
  count?: CountUpConfig;
  tone?: string;
}) {
  return (
    <div className="glass rounded-xl p-3.5">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone ?? ""}`}>{count ? <CountUp {...count} /> : value}</div>
    </div>
  );
}
