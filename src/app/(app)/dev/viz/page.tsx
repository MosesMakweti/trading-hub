import { notFound } from "next/navigation";

import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { DrawdownChart } from "@/components/analytics/drawdown-chart";
import { ChartCard, ChartStat, ChartStatRow } from "@/components/viz/chart-card";
import { formatPct } from "@/components/viz/format";
import { SERIES, VIZ } from "@/components/viz/tokens";
import { CumulativeRChart } from "@/components/backtesting/analytics/cumulative-r-chart";
import { AccountBalanceCurve } from "@/components/prop-firms/account-balance-curve";
import { PropFirmOverviewChart } from "@/components/prop-firms/prop-firm-overview-chart";
import { Card, GroupList } from "@/components/analytics/canonical-analytics-section";
import { HoursCard, RDistributionCard } from "@/components/analytics/distribution-cards";
import { Heatmap } from "@/components/analytics/heatmap";
import type { OverviewAccountInput } from "@/domain/prop-firms/overview-series";
import type { RawBalanceEvent } from "@/domain/prop-firms/balance-curve";
import { balanceCurve, balanceEvents, cumulativeR, dailyPercents, groupBy, hours, overviewAccounts, rBuckets, finalizedRCurve, fixtureTrades, percentCurve } from "@/components/viz/catalog/fixtures";

/**
 * Viz catalog — a dev-only gallery of every shared chart primitive rendered
 * against deterministic synthetic data (components/viz/catalog/fixtures.ts),
 * for design review and visual QA in both themes. 404s in production.
 */
export default function VizCatalogPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const trades = fixtureTrades();
  const balance = balanceCurve(trades);
  const maxDd = Math.max(...balance.map((b) => b.drawdownPercent));
  const lastDd = balance[balance.length - 1].drawdownPercent;

  return (
    <div className="mx-auto max-w-[1400px] space-y-8 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Viz catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dev-only. Shared chart primitives on synthetic data — see docs/ANALYTICS_VISUALIZATION.md.
        </p>
      </div>

      <Section title="Colour roles">
        <div className="glass grid gap-4 rounded-2xl p-4 sm:grid-cols-2">
          <Swatches
            title="Identity (categorical, fixed order)"
            items={SERIES.map((c, i) => ({ label: `viz-${i + 1}`, color: c }))}
          />
          <Swatches
            title="Polarity · status · reference"
            items={[
              { label: "profit", color: VIZ.profit },
              { label: "loss", color: VIZ.loss },
              { label: "neutral", color: VIZ.neutral },
              { label: "warning", color: VIZ.warning },
              { label: "reference", color: VIZ.reference },
            ]}
          />
        </div>
      </Section>

      <Section title="Equity instrument">
        <EquityCurveChart
          data={percentCurve(trades)}
          rCurve={cumulativeR(trades)}
          dollarCurve={balance}
          startingBalance={100_000}
        />
      </Section>

      <Section title="Breakdowns (GroupList — diverging R)">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="By strategy">
            <GroupList stats={groupBy(trades, (t) => t.strategy)} emptyLabel="—" />
          </Card>
          <Card title="By day of week">
            <GroupList
              stats={groupBy(trades, (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.weekday], ["Mon", "Tue", "Wed", "Thu", "Fri"])}
              emptyLabel="—"
            />
          </Card>
        </div>
      </Section>

      <Section title="Distributions">
        <div className="grid gap-4 lg:grid-cols-2">
          <RDistributionCard buckets={rBuckets(trades)} expectancy={0.31} />
          <HoursCard hours={hours(trades)} />
        </div>
      </Section>

      <Section title="Calendar heatmap">
        <ChartCard title="Daily account return">
          <Heatmap
            points={dailyPercents(trades).map((p) => ({ dateKey: p.dateKey, value: p.percent, label: `${p.dateKey}: ${p.percent}%` }))}
            scale="pnl"
          />
        </ChartCard>
      </Section>

      <Section title="Sequence mode (Backtesting)">
        <ChartCard title="Cumulative R" hint="closed trades in simulated-market order">
          <CumulativeRChart curve={finalizedRCurve(trades)} />
        </ChartCard>
      </Section>

      <Section title="Prop-firm balance">
        <AccountBalanceCurve events={balanceEvents(trades) as RawBalanceEvent[]} startingBalance={50_000} />
        <PropFirmOverviewChart accounts={overviewAccounts(trades) as OverviewAccountInput[]} />
      </Section>

      <Section title="Underwater">
        <ChartCard
          title="Underwater"
          headline={{ value: formatPct(-lastDd, 1), tone: lastDd > 0 ? "loss" : "profit", caption: "below peak now" }}
          footer={
            <ChartStatRow>
              <ChartStat label="Max drawdown" value={formatPct(-maxDd, 1)} tone="loss" />
              <ChartStat label="Current drawdown" value={formatPct(-lastDd, 1)} tone={lastDd > 0 ? "loss" : undefined} />
            </ChartStatRow>
          }
        >
          <DrawdownChart curve={balance} />
        </ChartCard>
        <ChartCard title="Empty state" empty={{ title: "No settled trades in this range yet", hint: "Widen the date range or log a trade." }} plotHeight={160} />
        <ChartCard title="Loading state" loading plotHeight={160} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ title, items }: { title: string; items: { label: string; color: string }[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-3">
        {items.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="h-6 w-10 rounded-md" style={{ background: s.color }} />
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
