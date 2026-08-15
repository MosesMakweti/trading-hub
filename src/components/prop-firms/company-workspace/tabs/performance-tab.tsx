import { LineChart } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { accountRoiPercent, type AggregateMetrics } from "@/domain/prop-firms/metrics";
import type { UserPropFirmDTO } from "@/types/prop-firms";

function formatPercent(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function PerformanceTab({ firm, metrics }: { firm: UserPropFirmDTO; metrics: AggregateMetrics }) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="Net trading P&L" value={formatSignedCurrency(metrics.netTradingPnl)} />
        <SummaryStat label="Account ROI" value={formatPercent(metrics.accountRoiPercent)} />
        <SummaryStat label="Investment ROI" value={formatPercent(metrics.traderInvestmentRoiPercent)} />
        <SummaryStat label="Net profit" value={formatSignedCurrency(metrics.netPropFirmProfit)} />
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl p-3.5">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}
