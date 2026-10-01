import { KpiCard } from "@/components/analytics/kpi-card";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { Card, GroupList } from "@/components/analytics/canonical-analytics-section";
import { RDistributionCard, HoursCard } from "@/components/analytics/distribution-cards";
import type { getAnalyticsData } from "@/server/services/analytics.service";
import type { CanonicalAnalyticsSummary } from "@/server/services/analytics-canonical.service";

type TradingData = Awaited<ReturnType<typeof getAnalyticsData>>["trading"];

const ratio = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
    </div>
  );
}

/**
 * Analytics Breakdowns — Stage 10.5: weekday/month/direction/session now come
 * from the canonical, R-primary dataset (one definition, shared with
 * Overview/Strategy/every other section); hour-of-day timing and risk-%
 * consistency stay on the Performance-Account ledger since they're either
 * pure trade-count distributions or genuine risk-management percentages —
 * never labeled "R". The realized-R distribution histogram is REAL R
 * (finalizedR), not the legacy $ contribution-% this used to plot.
 */
export function AnalyticsBreakdowns({ trading, canonical }: { trading: TradingData; canonical: CanonicalAnalyticsSummary }) {
  const b = trading.breakdowns;
  const c = canonical;

  return (
    <div className="space-y-8">
      {/* Performance by Day of Week / Month (canonical, Realized R) */}
      <section className="space-y-3">
        <SectionHeading title="Performance by Day of Week & Month" hint="Realized R — sample size shown" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="By day of week">
            <GroupList stats={c.byWeekday} emptyLabel="No trades in this range yet." />
          </Card>
          <Card title="By month">
            <GroupList stats={c.byMonth} emptyLabel="No trades in this range yet." />
          </Card>
        </div>
      </section>

      {/* Direction & Session (canonical, Realized R) */}
      <section className="space-y-3">
        <SectionHeading title="Direction & Session" hint="Realized R — sample size shown" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Long vs Short">
            <GroupList stats={c.byDirection} emptyLabel="No trades in this range yet." />
          </Card>
          <Card title="By session">
            <GroupList stats={c.bySession} emptyLabel="No trades in this range yet." />
          </Card>
        </div>
      </section>

      {/* Risk Analytics — genuine risk-management %, and timing distributions in $ (never labeled R) */}
      <section className="space-y-3">
        <SectionHeading title="Risk Analytics" />
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="glass flex items-center justify-center rounded-2xl px-8 py-4">
            <ProgressRing value={b.risk.consistency} tone="brand" label="Risk consistency" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard
              label="Avg Risk / Trade"
              value={b.risk.avgRisk == null ? "—" : `${b.risk.avgRisk.toFixed(2)}%`}
              count={b.risk.avgRisk == null ? undefined : { value: b.risk.avgRisk, decimals: 2, suffix: "%" }}
            />
            <KpiCard
              label="Largest Risk"
              value={b.risk.maxRisk == null ? "—" : `${b.risk.maxRisk.toFixed(2)}%`}
              count={b.risk.maxRisk == null ? undefined : { value: b.risk.maxRisk, decimals: 2, suffix: "%" }}
            />
            <KpiCard
              label="Recovery Factor"
              value={ratio(trading.recoveryFactor)}
              count={trading.recoveryFactor == null ? undefined : { value: trading.recoveryFactor, decimals: 2 }}
            />
            <KpiCard
              label="Max Drawdown"
              value={`${trading.maxDrawdownPercent.toFixed(1)}%`}
              count={{ value: trading.maxDrawdownPercent, decimals: 1, suffix: "%" }}
              tone="danger"
            />
            <KpiCard label="Consecutive Wins" value={String(c.overview.longestWinStreak)} tone="success" />
            <KpiCard label="Consecutive Losses" value={String(c.overview.longestLossStreak)} tone="danger" />
          </div>
        </div>
        <RDistributionCard buckets={c.rDistribution} expectancy={c.overview.expectancy} />
        {b.hours.length > 0 && <HoursCard hours={b.hours} />}
      </section>
    </div>
  );
}
