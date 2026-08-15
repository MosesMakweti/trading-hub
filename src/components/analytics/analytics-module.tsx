import { CandlestickChart } from "lucide-react";

import { cn } from "@/lib/utils";
import { DateRangeFilter } from "@/components/analytics/date-range-filter";
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar";
import { KpiCard } from "@/components/analytics/kpi-card";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { Donut } from "@/components/analytics/donut";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { DiscrepancyAnalytics } from "@/components/analytics/discrepancy-analytics";
import { OpportunityAnalytics } from "@/components/analytics/opportunity-analytics";
import { AdherenceAnalytics } from "@/components/analytics/adherence-analytics";
import { AnalyticsBreakdowns } from "@/components/analytics/analytics-breakdowns";
import { PsychologyAnalytics } from "@/components/analytics/psychology-analytics";
import { BestAssetTable } from "@/components/analytics/best-asset-table";
import { Heatmap, pnlHeatColor } from "@/components/analytics/heatmap";
import { PropFirmsAnalyticsSection } from "@/components/analytics/prop-firms-analytics-section";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  AnalyticsFilterOptions,
  getAnalyticsData,
} from "@/server/services/analytics.service";
import type { PropFirmAnalyticsSummary } from "@/server/services/prop-firms-analytics.service";
import type { DateRangePreset } from "@/lib/date-ranges";

type Data = Awaited<ReturnType<typeof getAnalyticsData>>;
type TradingData = Data["trading"];
type PsychologyData = Data["psychology"];

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneySigned = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const ratio = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const toneOf = (n: number): "success" | "danger" | "neutral" =>
  n > 0 ? "success" : n < 0 ? "danger" : "neutral";

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The Analytics module — TradeOS's central trading-performance intelligence
 * center. Composes the existing analytics calculations + dataviz primitives into
 * a sectioned, ring-forward terminal (no duplicate calculations; everything
 * derives from `getAnalyticsData`). Phase A: Performance Overview, full-width
 * Equity Curve, Discrepancy Gap, Strategy/Asset, Adherence, Behavioral, Daily
 * heatmap, and a Missed-Trades placeholder (that data isn't captured yet).
 */
export function AnalyticsModule({
  preset,
  from,
  to,
  trading,
  psychology,
  filterOptions,
  propFirmAnalytics,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  trading: TradingData;
  psychology: PsychologyData;
  filterOptions: AnalyticsFilterOptions;
  propFirmAnalytics: PropFirmAnalyticsSummary;
}) {
  const d = trading;
  const summary = d.counterfactual.summary;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your trading performance intelligence center — how, why, and when you perform.
            </p>
          </div>
          <DateRangeFilter preset={preset} from={from} to={to} />
        </div>
        <AnalyticsFilterBar options={filterOptions} />
      </div>

      {/* Prop Firms module (System B) — a separate data source from the
          Performance Account below, so it renders even when there are no
          closed System-A trades in range. */}
      <PropFirmsAnalyticsSection data={propFirmAnalytics} />

      {d.totalTrades === 0 ? (
        <EmptyState
          icon={CandlestickChart}
          title="No closed trades in this range"
          description="Log trades — or widen the date range — to see your performance analytics."
        />
      ) : (
        <>
          {/* Section A — Performance Overview */}
          <section className="space-y-3">
            <SectionHeading title="Performance Overview" hint="realized, from your Performance Account ledger" />

            <div className="glass grid grid-cols-2 items-center gap-4 rounded-xl px-4 py-5 sm:grid-cols-4 sm:px-6">
              <ProgressRing value={d.winRate} tone="brand" label="Win rate" />
              <ProgressRing value={summary.processEfficiencyPercent} tone="success" label="Process eff." />
              <div className="flex flex-col items-center justify-center gap-1 text-center">
                <span
                  className={`text-2xl font-semibold tabular-nums ${
                    summary.totalAvoidableGapR > 0 ? "text-danger" : "text-foreground"
                  }`}
                >
                  {summary.totalAvoidableGapR.toFixed(1)}R
                </span>
                <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Avoidable</span>
              </div>
              <Donut
                size={96}
                stroke={12}
                segments={[
                  { label: "Win", value: d.winningTrades, color: "var(--success)" },
                  { label: "Loss", value: d.losingTrades, color: "var(--danger)" },
                  { label: "BE", value: d.breakevenTrades, color: "var(--muted-foreground)" },
                ]}
              >
                <span className="text-lg font-semibold tabular-nums">{d.totalTrades}</span>
                <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Trades</span>
              </Donut>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <KpiCard label="Net P&L" value={moneySigned(d.netPnl)} tone={toneOf(d.netPnl)} />
              <KpiCard label="Gross Profit" value={money(d.grossProfit)} tone="success" />
              <KpiCard label="Gross Loss" value={money(d.grossLoss)} tone="danger" />
              <KpiCard label="Profit Factor" value={ratio(d.profitFactor)} />
              <KpiCard label="Expectancy" value={rr(d.expectancy)} />
              <KpiCard label="Average R" value={rr(d.averageRR)} />
              <KpiCard label="Average Win" value={rr(d.averageWinner)} tone="success" />
              <KpiCard label="Average Loss" value={rr(d.averageLoser)} tone="danger" />
              <KpiCard label="Largest Win" value={money(d.largestWin)} tone="success" />
              <KpiCard label="Largest Loss" value={money(d.largestLoss)} tone="danger" />
              <KpiCard
                label="Max Drawdown"
                value={`${money(d.maxDrawdownAmount)} · ${d.maxDrawdownPercent.toFixed(1)}%`}
                tone="danger"
              />
              <KpiCard label="Recovery Factor" value={ratio(d.recoveryFactor)} />
              <KpiCard
                label="Total Trades"
                value={String(d.totalTrades)}
                sublabel={`${d.winningTrades}W · ${d.losingTrades}L · ${d.breakevenTrades}BE`}
              />
              <KpiCard label="Longest Win Streak" value={String(d.longestWinStreak)} />
              <KpiCard label="Longest Loss Streak" value={String(d.longestLossStreak)} />
              <KpiCard label="Avg Trades / Day" value={d.averageTradesPerDay.toFixed(2)} />
            </div>
          </section>

          {/* Equity Curve — full width */}
          <section className="space-y-3">
            <SectionHeading title="Equity Curve" hint="cumulative return of the Performance Account" />
            <EquityCurveChart data={d.equityCurve} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Starting balance" value={money(d.startingBalance)} />
              <MiniStat label="Current balance" value={money(d.currentBalance)} />
              <MiniStat
                label="Max drawdown"
                value={`${d.maxDrawdownPercent.toFixed(1)}%`}
                tone={d.maxDrawdownPercent > 0 ? "danger" : undefined}
              />
              <MiniStat label="Recovery factor" value={ratio(d.recoveryFactor)} />
            </div>
          </section>

          {/* Discrepancy Gap (self-titled: Expected vs Actual + causes) */}
          <DiscrepancyAnalytics
            curve={d.counterfactual.curve}
            summary={summary}
            avgStrategyAdherence={d.adherence.avgTradeQuality}
            avgRuleAdherence={d.ruleAdherenceAverage}
          />

          {/* Strategy & Asset performance */}
          <section className="space-y-3">
            <SectionHeading title="Strategy & Asset Performance" hint="trade count shown — small samples aren't reliable" />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="glass space-y-3 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-muted-foreground">By strategy</h3>
                <StrategyTable stats={d.statsByStrategy} />
              </div>
              <div className="glass space-y-3 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-muted-foreground">By asset</h3>
                <BestAssetTable stats={d.statsByAsset} />
              </div>
            </div>
          </section>

          {/* Strategy Adherence + Confluences (self-titled) */}
          <AdherenceAnalytics data={d.adherence} />

          {/* Phase B: day-of-week, monthly, risk, and distribution breakdowns */}
          <AnalyticsBreakdowns trading={d} />

          {/* Behavioral analytics (self-titled inside) */}
          <section className="space-y-3">
            <SectionHeading title="Behavioral Analytics" hint="historical patterns from your post-trade questionnaire — not causation" />
            <PsychologyAnalytics data={psychology} />
          </section>

          {/* Daily performance heatmap */}
          <section className="space-y-3">
            <SectionHeading title="Daily Performance" />
            <div className="glass rounded-2xl p-4">
              <Heatmap
                points={d.dailyPercents.map((p) => ({
                  dateKey: p.dateKey,
                  value: p.percent,
                  label: `${p.dateKey}: ${p.percent >= 0 ? "+" : ""}${p.percent.toFixed(2)}%`,
                }))}
                getColor={pnlHeatColor}
              />
            </div>
          </section>

          {/* Opportunity Funnel — Edge Capture + Leakage vs Missed split */}
          <section className="space-y-3">
            <SectionHeading
              title="Opportunity & Edge Capture"
              hint="from tracked opportunities — separate from realized P&L"
            />
            <OpportunityAnalytics data={d.opportunity} />
          </section>
        </>
      )}
    </div>
  );
}

function StrategyTable({ stats }: { stats: TradingData["statsByStrategy"] }) {
  if (stats.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No trades in this range yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Strategy</th>
            <th className="py-2 pr-4 text-right font-normal">Trades</th>
            <th className="py-2 pr-4 text-right font-normal">Win Rate</th>
            <th className="py-2 pr-4 text-right font-normal">Avg R</th>
            <th className="py-2 text-right font-normal">Total Return</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={s.strategyLabel}
              className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/50"
            >
              <td className="py-2.5 pr-4 font-medium">{s.strategyLabel}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{s.totalTrades}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
                {s.winRate == null ? "—" : `${s.winRate.toFixed(0)}%`}
              </td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
                {s.averageRR == null ? "—" : `${s.averageRR.toFixed(2)}R`}
              </td>
              <td
                className={cn(
                  "py-2.5 text-right font-medium tabular-nums",
                  s.totalReturnPercent > 0 && "text-success",
                  s.totalReturnPercent < 0 && "text-danger",
                )}
              >
                {s.totalReturnPercent >= 0 ? "+" : ""}
                {s.totalReturnPercent.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
