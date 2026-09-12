import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { Card, GroupList } from "@/components/analytics/canonical-analytics-section";
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

function Histogram({ bars }: { bars: { label: string; count: number; tone: "success" | "danger" | "neutral" }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex h-32 items-end gap-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{b.count}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className={cn(
                "w-full rounded-t-sm",
                b.tone === "danger" ? "bg-danger/70" : b.tone === "success" ? "bg-success/70" : "bg-chart-2",
              )}
              style={{ height: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="text-center text-[9px] leading-tight text-muted-foreground/60">{b.label}</span>
        </div>
      ))}
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
        <div className="glass space-y-2 rounded-2xl p-4">
          <div className="text-xs font-medium text-muted-foreground">Realized R distribution</div>
          <Histogram
            bars={c.rDistribution.map((bucket) => ({
              label: bucket.label,
              count: bucket.count,
              tone: bucket.max <= 0 ? "danger" : bucket.min >= 0 ? "success" : "neutral",
            }))}
          />
        </div>
        {b.hours.length > 0 && (
          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground">Trades by hour of day</h3>
            <Histogram
              bars={b.hours.map((h) => ({
                label: `${String(h.hour).padStart(2, "0")}h`,
                count: h.trades,
                tone: h.netPnl > 0 ? "success" : h.netPnl < 0 ? "danger" : "neutral",
              }))}
            />
          </div>
        )}
      </section>
    </div>
  );
}
