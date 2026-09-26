import { BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtR } from "@/lib/analytics-format";
import { KpiCard } from "@/components/analytics/kpi-card";
import { AdherenceAnalytics } from "@/components/analytics/adherence-analytics";
import { BehaviourLists, Card, GroupList } from "@/components/analytics/canonical-analytics-section";
import { EmptyState } from "@/components/shared/empty-state";
import { CumulativeRChart } from "@/components/backtesting/analytics/cumulative-r-chart";
import { formatSimulationBalance } from "@/components/backtesting/format";
import type { BacktestAnalyticsSummary } from "@/domain/backtesting/backtest-analytics";
import type { RGroupStats } from "@/domain/analytics/canonical-aggregations";

const pct = (n: number | null, digits = 0) => (n == null ? "—" : `${n.toFixed(digits)}%`);
const ratio = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const toneOf = (n: number | null): "success" | "danger" | "neutral" => (n == null ? "neutral" : n > 0.001 ? "success" : n < -0.001 ? "danger" : "neutral");

/** A breakdown worth showing: more than one group (a one-bar chart says nothing). */
function Breakdown({ title, stats }: { title: string; stats: RGroupStats[] }) {
  if (stats.filter((s) => s.count > 0).length < 2) return null;
  return (
    <Card title={title} hint="R by group · n = closed trades">
      <GroupList showPnl={false} stats={stats} emptyLabel="No data yet." />
    </Card>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", className)}>{value}</dd>
    </div>
  );
}

/**
 * Backtesting Analytics — renders the run's canonical summary. Every number
 * is computed server-side by the canonical engine; this only presents it.
 * All associations are descriptive (what happened alongside what), never
 * causal claims.
 */
export function BacktestAnalyticsView({ summary }: { summary: BacktestAnalyticsSummary }) {
  const o = summary.overview;
  if (o.totalTrades === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Backtesting Analytics"
        description="Analytics will become available as this run accumulates completed backtesting trades."
      />
    );
  }
  const sample = `${o.finalizedTrades} closed trade${o.finalizedTrades === 1 ? "" : "s"}`;
  const dd = summary.drawdown;
  const b = summary.breakdowns;
  const hasAnyBreakdown = [b.asset, b.session, b.direction, b.timeframe, b.weekday, b.month, b.entryModel, b.setupType, b.strategy].some(
    (s) => s.filter((g) => g.count > 0).length >= 2,
  );

  return (
    <div className="space-y-8">
      {o.openTrades > 0 && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          {o.openTrades} executed trade{o.openTrades === 1 ? " is" : "s are"} still open and not yet counted in results. A trade counts once its recorded exits close the full position.
        </p>
      )}

      <section aria-label="Overview" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <KpiCard label="Net R" value={fmtR(o.finalizedTrades ? o.netR : null)} sublabel={sample} tone={toneOf(o.netR)} size="lg" />
          <KpiCard label="Win rate" value={pct(o.winRate)} sublabel={`${o.wins}W · ${o.losses}L · ${o.breakevens}BE`} />
          <KpiCard label="Expectancy" value={fmtR(o.expectancy)} sublabel="per closed trade" tone={toneOf(o.expectancy)} />
          <KpiCard label="Profit factor" value={ratio(o.profitFactor)} sublabel={o.profitFactor == null && o.finalizedTrades > 0 ? "no losing trades yet" : sample} />
          <KpiCard label="Trades" value={String(o.totalTrades)} sublabel={`${o.finalizedTrades} closed · ${o.openTrades} open`} />
          <KpiCard label="Average R" value={fmtR(o.averageR)} sublabel={sample} tone={toneOf(o.averageR)} />
          <KpiCard label="Avg winner" value={fmtR(o.averageWinnerR)} sublabel={`${o.wins} winners`} tone="success" />
          <KpiCard label="Avg loser" value={fmtR(o.averageLoserR)} sublabel={`${o.losses} losers`} tone="danger" />
          <KpiCard label="Best trade" value={fmtR(o.bestTradeR)} tone={toneOf(o.bestTradeR)} />
          <KpiCard label="Worst trade" value={fmtR(o.worstTradeR)} tone={toneOf(o.worstTradeR)} />
          <KpiCard label="Streaks" value={`${o.longestWinStreak}W / ${o.longestLossStreak}L`} sublabel="longest win / loss run" />
          <KpiCard label="Missed setups" value={String(summary.missed.missedOpportunities)} sublabel={summary.missed.missRate == null ? "no resolved setups" : `${pct(summary.missed.missRate)} of valid setups`} />
        </div>
      </section>

      <Card title="Cumulative R" hint="closed trades in simulated-market order">
        <CumulativeRChart curve={summary.curve} />
        {dd && (
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
            <Stat label="Max drawdown" value={fmtR(dd.maxDrawdownR)} className={dd.maxDrawdownR < 0 ? "text-danger" : undefined} />
            <Stat label="From peak" value={fmtR(dd.peakR)} />
            <Stat label="To trough" value={fmtR(dd.troughR)} />
            <Stat label="Current drawdown" value={fmtR(dd.currentDrawdownR)} className={dd.currentDrawdownR < 0 ? "text-danger" : undefined} />
          </dl>
        )}
      </Card>

      {summary.simulation && (
        <Card title="Simulated balance" hint="simulation only — not a trading account">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Starting" value={formatSimulationBalance(summary.simulation.startingBalance, summary.simulation.currency)} />
            <Stat label="Ending" value={formatSimulationBalance(summary.simulation.endingBalance, summary.simulation.currency)} />
            <Stat label="Return" value={pct(summary.simulation.returnPercent, 1)} className={summary.simulation.returnPercent >= 0 ? "text-success" : "text-danger"} />
            <Stat label="Max drawdown" value={pct(summary.simulation.maxDrawdownPercent, 1)} className={summary.simulation.maxDrawdownPercent < 0 ? "text-danger" : undefined} />
          </dl>
          <p className="text-[11px] text-muted-foreground">
            Fixed risk of {summary.simulation.riskPercentPerTrade}% of the starting balance per 1R ({formatSimulationBalance(summary.simulation.riskPerR, summary.simulation.currency)}), no compounding.
          </p>
        </Card>
      )}

      {hasAnyBreakdown && (
        <section aria-label="Breakdowns" className="space-y-3">
          <h2 className="text-lg font-semibold">Performance breakdowns</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Breakdown title="By asset" stats={b.asset} />
            <Breakdown title="By direction" stats={b.direction} />
            <Breakdown title="By session" stats={b.session} />
            <Breakdown title="By timeframe" stats={b.timeframe} />
            <Breakdown title="By weekday (simulated date)" stats={b.weekday} />
            <Breakdown title="By month (simulated date)" stats={b.month} />
            <Breakdown title="By entry model" stats={b.entryModel} />
            <Breakdown title="By setup type" stats={b.setupType} />
            <Breakdown title="By strategy version" stats={b.strategy} />
          </div>
        </section>
      )}

      <section aria-label="Strategy adherence" className="space-y-3">
        <h2 className="text-lg font-semibold">Strategy adherence</h2>
        <p className="text-sm text-muted-foreground">
          Scored against the strategy as it was frozen on each trade — later Strategy Lab edits never change these results.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Mandatory confluences" hint={summary.validation.averageAdherencePercent == null ? undefined : `avg adherence ${pct(summary.validation.averageAdherencePercent)}`}>
            <GroupList showPnl={false} stats={summary.validation.mandatoryGate} emptyLabel="No scored setups yet." />
          </Card>
          <Card title="Setup validation">
            <GroupList showPnl={false} stats={summary.validation.byState} emptyLabel="No Setup Type validations recorded." />
          </Card>
          {summary.validation.overrideReasons.length > 0 && (
            <Card title="Override reasons">
              <GroupList showPnl={false} stats={summary.validation.overrideReasons} emptyLabel="No overrides." />
            </Card>
          )}
        </div>
        <AdherenceAnalytics data={summary.adherence} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Confluences" hint="present on the trade · descriptive">
            <GroupList showPnl={false} stats={summary.confluences} emptyLabel="No confluences recorded on trades yet." />
          </Card>
          <Card title="Execution confirmations" hint="present on the trade · descriptive">
            <GroupList showPnl={false} stats={summary.executionConfirmations} emptyLabel="No execution confirmations recorded yet." />
          </Card>
        </div>
      </section>

      <section aria-label="Missed trades" className="space-y-3">
        <h2 className="text-lg font-semibold">Missed trades</h2>
        <Card title="Valid setups" hint="spotted setups scored valid">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Executed" value={String(summary.missed.executedOpportunities)} />
            <Stat label="Missed" value={String(summary.missed.missedOpportunities)} />
            <Stat label="Miss rate" value={pct(summary.missed.missRate)} />
            <Stat label="Invalidated / expired" value={`${summary.missed.invalidated} / ${summary.missed.expired}`} />
          </dl>
          {summary.missed.missedOpportunities > 0 && (
            <div className="space-y-2 border-t border-border pt-3 text-sm">
              <p className="text-muted-foreground">
                Your recorded outcomes: {summary.missed.outcomes.missedWin} would-have-won · {summary.missed.outcomes.missedLoss} would-have-lost · {summary.missed.outcomes.missedBreakeven} breakeven · {summary.missed.outcomes.undetermined} undetermined
                {summary.missed.selfReportedMissedR != null && <> · self-reported {fmtR(summary.missed.selfReportedMissedR)}</>}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {summary.missed.reasons.byReason.map((r) => (
                  <li key={r.reason} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {r.reason.replaceAll("_", " ").toLowerCase()} · {r.count}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground/70">Missed-trade outcomes are what you recorded, never estimated by Traditorium.</p>
            </div>
          )}
        </Card>
      </section>

      <section aria-label="Psychology and behaviour" className="space-y-3">
        <h2 className="text-lg font-semibold">Psychology &amp; behaviour</h2>
        <p className="text-sm text-muted-foreground">Descriptive associations from your reviews — not proof of cause.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Pre-trade mood" hint={summary.psychology.averagePsychologyPercent == null ? undefined : `avg psychology ${pct(summary.psychology.averagePsychologyPercent)} · n=${summary.psychology.psychologySample}`}>
            <GroupList showPnl={false} stats={summary.psychology.moodTags} emptyLabel="No mood tags recorded yet." />
          </Card>
          <Card title="Behaviour labels">
            <BehaviourLists stats={summary.psychology.behaviourLabels} showPnl={false} />
          </Card>
        </div>
      </section>
    </div>
  );
}
