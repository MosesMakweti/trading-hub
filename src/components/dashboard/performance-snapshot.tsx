import type { ComponentProps } from "react";
import Link from "next/link";

import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";

/**
 * Performance Snapshot — the Dashboard's at-a-glance health check: headline KPIs
 * over the equity curve, all derived from the Performance Account (the app's
 * single source of truth). Composes the existing KpiCard + EquityCurveChart.
 */
export function PerformanceSnapshot({
  winRate,
  totalTrades,
  bestAccount,
  bestAsset,
  equityCurve,
}: {
  winRate: number | null;
  totalTrades: number;
  bestAccount: { name: string; returnPercent: number } | null;
  bestAsset: { assetSymbol: string; totalReturnPercent: number } | null;
  equityCurve: ComponentProps<typeof EquityCurveChart>["data"];
}) {
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Performance snapshot</h2>
        <Link href="/journal" className="text-xs text-primary hover:underline">
          Full analytics →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Win rate" value={winRate == null ? "—" : `${winRate.toFixed(1)}%`} />
        <KpiCard label="Total trades" value={String(totalTrades)} />
        <KpiCard
          label="Best account"
          value={bestAccount?.name ?? "—"}
          sublabel={bestAccount ? signed(bestAccount.returnPercent) : undefined}
          tone={bestAccount && bestAccount.returnPercent >= 0 ? "success" : "neutral"}
        />
        <KpiCard
          label="Best asset"
          value={bestAsset?.assetSymbol ?? "—"}
          sublabel={bestAsset ? signed(bestAsset.totalReturnPercent) : undefined}
          tone={bestAsset && bestAsset.totalReturnPercent >= 0 ? "success" : "neutral"}
        />
      </div>

      <EquityCurveChart data={equityCurve} />
    </section>
  );
}
