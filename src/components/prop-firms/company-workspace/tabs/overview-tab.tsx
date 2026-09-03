import {
  AlertTriangle,
  Award,
  Banknote,
  Coins,
  Percent,
  PiggyBank,
  ShieldAlert,
  Swords,
  Target,
  TrendingUp,
} from "lucide-react";

import { KpiCard } from "@/components/analytics/kpi-card";
import { Donut, type DonutSegment } from "@/components/analytics/donut";
import type { CountUpConfig } from "@/components/analytics/count-up";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { formatDate } from "@/components/prop-firms/format";
import type { AggregateMetrics } from "@/domain/prop-firms/metrics";
import { challengePassRatePercent } from "@/domain/prop-firms/metrics";
import type { UserPropFirmDTO } from "@/types/prop-firms";
import { ProgressRing } from "@/components/analytics/progress-ring";

function formatPercent(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function toneFor(n: number | null): "neutral" | "success" | "danger" {
  if (n == null || n === 0) return "neutral";
  return n > 0 ? "success" : "danger";
}

function countOf(v: number | null, config: Omit<CountUpConfig, "value">): CountUpConfig | undefined {
  return v == null ? undefined : { value: v, ...config };
}

export function OverviewTab({ firm, metrics }: { firm: UserPropFirmDTO; metrics: AggregateMetrics }) {
  const stages = firm.accounts.flatMap((a) => a.stages);
  const resolved = stages.filter((s) => ["PASSED", "FAILED", "BREACHED", "ABANDONED"].includes(s.status));
  const passed = resolved.filter((s) => s.status === "PASSED");
  const passRate = challengePassRatePercent(passed.length, resolved.length);

  const recentMilestones = firm.accounts
    .flatMap((a) => a.milestones.map((m) => ({ ...m, accountName: a.displayName })))
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
    .slice(0, 5);

  const statusCounts = firm.accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusSegments: DonutSegment[] = [
    { label: "Active", value: statusCounts.ACTIVE ?? 0, color: "var(--chart-1)" },
    { label: "Funded", value: statusCounts.FUNDED ?? 0, color: "var(--success)" },
    { label: "Passed", value: statusCounts.PASSED ?? 0, color: "var(--chart-3)" },
    { label: "Failed", value: statusCounts.FAILED ?? 0, color: "var(--warning)" },
    { label: "Breached", value: statusCounts.BREACHED ?? 0, color: "var(--danger)" },
    { label: "Archived", value: statusCounts.ARCHIVED ?? 0, color: "var(--muted-foreground)" },
  ].filter((s) => s.value > 0);

  if (firm.accounts.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No purchased accounts yet — add one to start tracking performance for {firm.companyName}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_auto_1fr]">
        <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl p-5">
          <ProgressRing
            value={passRate}
            size={88}
            stroke={7}
            tone={passRate == null ? "muted" : passRate >= 50 ? "success" : "warning"}
            label="Pass rate"
          />
        </div>
        {statusSegments.length > 0 && (
          <div className="glass flex flex-col items-center justify-center gap-1 rounded-2xl p-5">
            <Donut segments={statusSegments} size={88} stroke={12} legend={false}>
              <span className="text-sm font-semibold tabular-nums">{firm.accounts.length}</span>
            </Donut>
            <span className="text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Account status
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Active challenges" value={String(metrics.activeChallengeCount)} count={countOf(metrics.activeChallengeCount, {})} icon={Swords} />
          <KpiCard label="Funded accounts" value={String(metrics.fundedCount)} count={countOf(metrics.fundedCount, {})} icon={Award} />
          <KpiCard
            label="At risk"
            value={String(metrics.atRiskCount)}
            count={countOf(metrics.atRiskCount, {})}
            icon={AlertTriangle}
            tone={metrics.atRiskCount > 0 ? "danger" : "neutral"}
          />
          <KpiCard
            label="Breached"
            value={String(metrics.breachedCount)}
            count={countOf(metrics.breachedCount, {})}
            icon={ShieldAlert}
            tone={metrics.breachedCount > 0 ? "danger" : "neutral"}
          />
          <KpiCard
            label="Combined balance"
            value={formatCurrency(metrics.combinedCurrentBalance)}
            count={countOf(metrics.combinedCurrentBalance, { decimals: 2, prefix: "$", grouping: true })}
            icon={Banknote}
          />
          <KpiCard
            label="Net trading P&L"
            value={formatSignedCurrency(metrics.netTradingPnl)}
            count={countOf(metrics.netTradingPnl, { decimals: 2, prefix: "$", grouping: true, signed: true })}
            icon={TrendingUp}
            tone={toneFor(metrics.netTradingPnl)}
          />
          <KpiCard
            label="Total costs"
            value={formatCurrency(metrics.totalCosts)}
            count={countOf(metrics.totalCosts, { decimals: 2, prefix: "$", grouping: true })}
            icon={Coins}
          />
          <KpiCard
            label="Payouts received"
            value={formatCurrency(metrics.totalPayoutsReceived)}
            count={countOf(metrics.totalPayoutsReceived, { decimals: 2, prefix: "$", grouping: true })}
            icon={PiggyBank}
          />
          <KpiCard
            label="Investment ROI"
            value={formatPercent(metrics.traderInvestmentRoiPercent)}
            count={countOf(metrics.traderInvestmentRoiPercent, { decimals: 1, suffix: "%", signed: true })}
            icon={Percent}
            tone={toneFor(metrics.traderInvestmentRoiPercent)}
          />
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <Target className="size-4 text-muted-foreground" />
        </div>
        {recentMilestones.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No milestones recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentMilestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs">
                <span>
                  <span className="font-medium">{m.title ?? m.type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground"> · {m.accountName}</span>
                </span>
                <span className="text-muted-foreground">{formatDate(m.achievedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {firm.notes && (
        <div className="glass rounded-2xl p-4">
          <h2 className="mb-1.5 text-sm font-medium">Notes</h2>
          <p className="text-xs text-muted-foreground">{firm.notes}</p>
        </div>
      )}
    </div>
  );
}
