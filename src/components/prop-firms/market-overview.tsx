import {
  AlertTriangle,
  Award,
  Banknote,
  Building2,
  Coins,
  Flame,
  Percent,
  PiggyBank,
  ShieldAlert,
  Swords,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { KpiCard } from "@/components/analytics/kpi-card";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { AggregateMetrics } from "@/domain/prop-firms/metrics";

function formatPercent(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function toneFor(n: number | null): "neutral" | "success" | "danger" {
  if (n == null || n === 0) return "neutral";
  return n > 0 ? "success" : "danger";
}

/**
 * The Market Overview — every metric from spec section 2, computed entirely
 * from `aggregateAccounts` (domain/prop-firms/metrics.ts). One prominent
 * ring for the pass rate (the one metric that's naturally 0-100%); the rest
 * are compact KPI tiles — "rings... only where they improve understanding".
 */
export function MarketOverview({
  metrics,
  firmCount,
  passRatePercent,
}: {
  metrics: AggregateMetrics;
  firmCount: number;
  passRatePercent: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
      <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl p-5">
        <ProgressRing
          value={passRatePercent}
          size={92}
          stroke={7}
          tone={passRatePercent == null ? "muted" : passRatePercent >= 50 ? "success" : "warning"}
          label="Challenge pass rate"
        />
        {passRatePercent == null && (
          <span className="text-center text-[11px] text-muted-foreground">No resolved stages yet</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Prop firms" value={String(firmCount)} icon={Building2} />
        <KpiCard label="Active accounts" value={String(metrics.activeAccountCount)} icon={Wallet} />
        <KpiCard label="Active challenges" value={String(metrics.activeChallengeCount)} icon={Swords} />
        <KpiCard label="Funded accounts" value={String(metrics.fundedCount)} icon={Award} />
        <KpiCard
          label="Accounts at risk"
          value={String(metrics.atRiskCount)}
          icon={AlertTriangle}
          tone={metrics.atRiskCount > 0 ? "danger" : "neutral"}
        />
        <KpiCard
          label="Accounts breached"
          value={String(metrics.breachedCount)}
          icon={ShieldAlert}
          tone={metrics.breachedCount > 0 ? "danger" : "neutral"}
        />
        <KpiCard label="Combined balance" value={formatCurrency(metrics.combinedCurrentBalance)} icon={Banknote} />
        <KpiCard
          label="Net trading P&L"
          value={formatSignedCurrency(metrics.netTradingPnl)}
          icon={TrendingUp}
          tone={toneFor(metrics.netTradingPnl)}
        />
        <KpiCard label="Total costs" value={formatCurrency(metrics.totalCosts)} icon={Flame} />
        <KpiCard label="Payouts received" value={formatCurrency(metrics.totalPayoutsReceived)} icon={PiggyBank} />
        <KpiCard
          label="Net prop-firm profit"
          value={formatSignedCurrency(metrics.netPropFirmProfit)}
          icon={Coins}
          tone={toneFor(metrics.netPropFirmProfit)}
        />
        <KpiCard
          label="Account ROI"
          value={formatPercent(metrics.accountRoiPercent)}
          icon={Target}
          tone={toneFor(metrics.accountRoiPercent)}
        />
        <KpiCard
          label="Trader investment ROI"
          value={formatPercent(metrics.traderInvestmentRoiPercent)}
          icon={Percent}
          tone={toneFor(metrics.traderInvestmentRoiPercent)}
        />
      </div>
    </div>
  );
}
