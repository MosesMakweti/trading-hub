import { CandlestickChart, Timer } from "lucide-react";

import { cn } from "@/lib/utils";
import { DateRangeFilter } from "@/components/analytics/date-range-filter";
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar";
import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { DiscrepancyAnalytics } from "@/components/analytics/discrepancy-analytics";
import { AdherenceAnalytics } from "@/components/analytics/adherence-analytics";
import { AnalyticsBreakdowns } from "@/components/analytics/analytics-breakdowns";
import { PsychologyAnalytics } from "@/components/analytics/psychology-analytics";
import { BestAssetTable } from "@/components/analytics/best-asset-table";
import { Heatmap, pnlHeatColor } from "@/components/analytics/heatmap";
import { EmptyState } from "@/components/shared/empty-state";
import type {
  AnalyticsFilterOptions,
  getAnalyticsData,
} from "@/server/services/analytics.service";
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

// Inline SVG ring + outcome donut — kept local so this module doesn't depend on
// the UI-overhaul primitives (ProgressRing/Donut) that live on a separate branch.
// Swap for the shared primitives once that lands.
function Ring({ value, label, color }: { value: number | null; label: string; color: string }) {
  const size = 76;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
          {value != null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
          {value == null ? "—" : `${Math.round(value)}%`}
        </div>
      </div>
      <span className="text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

function OutcomeDonut({ win, loss, be }: { win: number; loss: number; be: number }) {
  const size = 96;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 3;
  const total = win + loss + be;
  const segments = [
    { label: "Win", value: win, color: "var(--success)" },
    { label: "Loss", value: loss, color: "var(--danger)" },
    { label: "BE", value: be, color: "var(--muted-foreground)" },
  ];
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
          {total > 0 &&
            segments
              .filter((s) => s.value > 0)
              .map((s) => {
                const len = (s.value / total) * circumference;
                const visible = Math.max(len - gap, 0.001);
                const el = (
                  <circle
                    key={s.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={stroke}
                    strokeDasharray={`${visible} ${circumference - visible}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return el;
              })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Trades</span>
        </div>
      </div>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label} <span className="text-foreground tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  trading: TradingData;
  psychology: PsychologyData;
  filterOptions: AnalyticsFilterOptions;
}) {
  const d = trading;
  const summary = d.discrepancy.summary;

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
              <Ring value={d.winRate} color="var(--chart-1)" label="Win rate" />
              <Ring value={summary.executionEfficiencyPercent} color="var(--success)" label="Execution eff." />
              <Ring value={summary.edgeCapturePercent} color="var(--warning)" label="Edge capture" />
              <OutcomeDonut win={d.winningTrades} loss={d.losingTrades} be={d.breakevenTrades} />
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
            curve={d.discrepancy.curve}
            summary={summary}
            causes={d.discrepancy.causes}
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

          {/* Missed Trades — placeholder (data not captured yet) */}
          <section className="space-y-3">
            <SectionHeading title="Missed Trades" />
            <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
              <Timer className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium">Missed-trade analytics — coming soon</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Analyzing missed opportunities (count, estimated impact, executed-vs-missed, effect on
                the Discrepancy Gap) requires a missed-trade capture feature, which TradeOS doesn&apos;t
                collect yet. This stays separate from realized P&L — opportunity is never counted as
                actual performance.
              </p>
            </div>
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
