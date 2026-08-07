import type { ComponentProps } from "react";
import Link from "next/link";
import { Activity, Hash, Landmark, TrendingUp } from "lucide-react";

import { KpiCard } from "@/components/analytics/kpi-card";
import { directionOf } from "@/components/analytics/delta-chip";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { Donut } from "@/components/analytics/donut";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { DiscrepancyGapCard } from "@/components/dashboard/discrepancy-gap-card";
import type { DiscrepancyPoint, DiscrepancySummary } from "@/domain/analytics/execution-engine";

/**
 * Performance Snapshot — the Dashboard's at-a-glance health check: headline KPIs
 * over the equity curve, all derived from the Performance Account (the app's
 * single source of truth). Composes the existing KpiCard + EquityCurveChart.
 */
export function PerformanceSnapshot({
  winRate,
  winRateSeries,
  totalTrades,
  winningTrades,
  losingTrades,
  bestAccount,
  bestAsset,
  equityCurve,
  discrepancy,
}: {
  winRate: number | null;
  winRateSeries: number[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  bestAccount: { name: string; returnPercent: number } | null;
  bestAsset: { assetSymbol: string; totalReturnPercent: number } | null;
  equityCurve: ComponentProps<typeof EquityCurveChart>["data"];
  discrepancy: { curve: DiscrepancyPoint[]; summary: DiscrepancySummary };
}) {
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const breakeven = Math.max(0, totalTrades - winningTrades - losingTrades);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Performance snapshot</h2>
        <Link href="/journal" className="text-xs text-primary hover:underline">
          Full analytics →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Win rate"
          value={winRate == null ? "—" : `${winRate.toFixed(1)}%`}
          icon={Activity}
          spark={winRateSeries}
          sparkTone="brand"
        />
        <KpiCard label="Total trades" value={String(totalTrades)} icon={Hash} />
        <KpiCard
          label="Best account"
          value={bestAccount?.name ?? "—"}
          icon={Landmark}
          delta={
            bestAccount
              ? { value: signed(bestAccount.returnPercent), direction: directionOf(bestAccount.returnPercent) }
              : undefined
          }
        />
        <KpiCard
          label="Best asset"
          value={bestAsset?.assetSymbol ?? "—"}
          icon={TrendingUp}
          delta={
            bestAsset
              ? { value: signed(bestAsset.totalReturnPercent), direction: directionOf(bestAsset.totalReturnPercent) }
              : undefined
          }
        />
      </div>

      <div className="glass grid grid-cols-2 items-center gap-4 rounded-xl px-4 py-5 sm:grid-cols-4 sm:px-6">
        <ProgressRing value={winRate} tone="brand" label="Win rate" />
        <ProgressRing
          value={discrepancy.summary.executionEfficiencyPercent}
          tone="success"
          label="Execution eff."
        />
        <ProgressRing
          value={discrepancy.summary.edgeCapturePercent}
          tone="warning"
          label="Edge capture"
        />
        <Donut
          size={96}
          stroke={12}
          segments={[
            { label: "Win", value: winningTrades, color: "var(--success)" },
            { label: "Loss", value: losingTrades, color: "var(--danger)" },
            { label: "BE", value: breakeven, color: "var(--muted-foreground)" },
          ]}
        >
          <span className="text-lg font-semibold tabular-nums">{totalTrades}</span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Trades</span>
        </Donut>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EquityCurveChart data={equityCurve} />
        <DiscrepancyGapCard curve={discrepancy.curve} summary={discrepancy.summary} />
      </div>
    </section>
  );
}
