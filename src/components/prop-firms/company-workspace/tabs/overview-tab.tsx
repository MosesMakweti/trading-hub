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

export function OverviewTab({ firm, metrics }: { firm: UserPropFirmDTO; metrics: AggregateMetrics }) {
  const stages = firm.accounts.flatMap((a) => a.stages);
  const resolved = stages.filter((s) => ["PASSED", "FAILED", "BREACHED", "ABANDONED"].includes(s.status));
  const passed = resolved.filter((s) => s.status === "PASSED");
  const passRate = challengePassRatePercent(passed.length, resolved.length);

  const recentMilestones = firm.accounts
    .flatMap((a) => a.milestones.map((m) => ({ ...m, accountName: a.displayName })))
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt))
    .slice(0, 5);

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl p-5">
          <ProgressRing
            value={passRate}
            size={88}
            stroke={7}
            tone={passRate == null ? "muted" : passRate >= 50 ? "success" : "warning"}
            label="Pass rate"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Active challenges" value={String(metrics.activeChallengeCount)} icon={Swords} />
          <KpiCard label="Funded accounts" value={String(metrics.fundedCount)} icon={Award} />
          <KpiCard
            label="At risk"
            value={String(metrics.atRiskCount)}
            icon={AlertTriangle}
            tone={metrics.atRiskCount > 0 ? "danger" : "neutral"}
          />
          <KpiCard
            label="Breached"
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
          <KpiCard label="Total costs" value={formatCurrency(metrics.totalCosts)} icon={Coins} />
          <KpiCard label="Payouts received" value={formatCurrency(metrics.totalPayoutsReceived)} icon={PiggyBank} />
          <KpiCard
            label="Investment ROI"
            value={formatPercent(metrics.traderInvestmentRoiPercent)}
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
