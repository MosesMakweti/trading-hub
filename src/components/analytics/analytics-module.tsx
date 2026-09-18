import { CandlestickChart, Activity, TrendingUp, Wallet, Layers, Brain, CalendarDays, ClipboardList, Target, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmtR, fmtUsd, tone as rTone } from "@/lib/analytics-format";
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
import { Heatmap, pnlHeatColor } from "@/components/analytics/heatmap";
import { PropFirmsAnalyticsSection } from "@/components/analytics/prop-firms-analytics-section";
import { AnalyticsImprovementSection } from "@/components/analytics/analytics-improvement-section";
import { Card, GroupList, BehaviourLists, RCurveChart } from "@/components/analytics/canonical-analytics-section";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { SectionNav } from "@/components/analytics/section-nav";
import type {
  AnalyticsFilterOptions,
  getAnalyticsData,
} from "@/server/services/analytics.service";
import type { PropFirmAnalyticsSummary } from "@/server/services/prop-firms-analytics.service";
import type {
  CanonicalAnalyticsSummary,
  CanonicalFilterOptionsDTO,
} from "@/server/services/analytics-canonical.service";
import type { DateRangePreset } from "@/lib/date-ranges";
import type { ImprovementAnalyticsDTO } from "@/types/edge-improvements";

type Data = Awaited<ReturnType<typeof getAnalyticsData>>;
type TradingData = Data["trading"];
type PsychologyData = Data["psychology"];

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneySigned = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const ratio = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const toneOf = (n: number): "success" | "danger" | "neutral" =>
  n > 0 ? "success" : n < 0 ? "danger" : "neutral";

function SectionHeading({
  title,
  hint,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
        {title}
      </h2>
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
 * The Analytics module — Traditorium's central trading-performance intelligence
 * center. Stage 10.5 (source-of-truth migration): the canonical, R-primary
 * dataset (analytics-canonical.service.ts) is now the ONE definition of
 * trader-performance analytics (Overview KPIs, the Performance Curve,
 * Strategy/Setup Type/Asset, Validation, Bias, Behaviour, Mood, weekday/
 * month/direction/session breakdowns). Genuine account/equity accounting —
 * realized $ balance, drawdown, Discrepancy Gap, Opportunity capture — stays
 * on the Performance-Account ledger (`trading`, from getAnalyticsData) under
 * its own clearly-labeled "Account Equity" section, never mixed into the
 * R-primary KPIs above it. There is no more separate "Realized R Analytics"
 * section — its widgets are redistributed into the sections below so the
 * page reads as one coherent Analytics experience.
 */
export function AnalyticsModule({
  preset,
  from,
  to,
  trading,
  psychology,
  filterOptions,
  propFirmAnalytics,
  canonical,
  canonicalFilterOptions,
  improvement,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  trading: TradingData;
  psychology: PsychologyData;
  filterOptions: AnalyticsFilterOptions;
  propFirmAnalytics: PropFirmAnalyticsSummary;
  /** The canonical, R-primary dataset summary — source of truth for trader
   *  performance across the whole page (Stage 10.5). */
  canonical: CanonicalAnalyticsSummary;
  canonicalFilterOptions: CanonicalFilterOptionsDTO;
  /** Stage 19.1 — commitment adherence over time, weekly/monthly kept as
   *  separate series (never merged — §20). Independent of the date-range
   *  filters above; commitments have their own review periods. */
  improvement: { weekly: ImprovementAnalyticsDTO; monthly: ImprovementAnalyticsDTO };
}) {
  const d = trading;
  const c = canonical;
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
        <AnalyticsFilterBar options={filterOptions} canonicalOptions={canonicalFilterOptions} />
      </div>

      <StaggerList className="space-y-8">
        {/* Prop Firms module (System B) — a separate data source from the
            Performance Account below, so it renders even when there are no
            closed System-A trades in range. */}
        <StaggerItem>
          <PropFirmsAnalyticsSection data={propFirmAnalytics} />
        </StaggerItem>

        {/* Improvement (Stage 19.1) — commitment adherence over time, a
            separate question from realized performance, so it renders
            independent of the date-range/trade filters above. */}
        <StaggerItem>
          <section id="section-improvement" className="scroll-mt-24 space-y-3">
            <SectionHeading title="Improvement" hint="behavioral change — never profitability" icon={ClipboardList} />
            <AnalyticsImprovementSection weekly={improvement.weekly} monthly={improvement.monthly} />
          </section>
        </StaggerItem>

        {d.totalTrades > 0 && <SectionNav />}

        {d.totalTrades === 0 ? (
          <StaggerItem>
            <EmptyState
              icon={CandlestickChart}
              title="No closed trades in this range"
              description="Log trades — or widen the date range — to see your performance analytics."
            />
          </StaggerItem>
        ) : (
          <>
            {/* Section A — Performance Overview (canonical, R-primary) */}
            <StaggerItem>
              <section id="section-overview" className="scroll-mt-24 space-y-3">
                <SectionHeading title="Performance Overview" hint="Realized R primary — PnL secondary" icon={Activity} />

                <div className="glass grid grid-cols-1 items-center gap-4 rounded-xl px-4 py-5 sm:grid-cols-3 sm:px-6">
                  <ProgressRing value={c.overview.winRate} tone="brand" label="Win rate" />
                  <div className="flex flex-col items-center justify-center gap-1 text-center">
                    <span
                      className={cn(
                        "text-2xl font-semibold tabular-nums",
                        rTone(c.overview.totalRealizedR) === "success" && "text-success",
                        rTone(c.overview.totalRealizedR) === "danger" && "text-danger",
                      )}
                    >
                      {fmtR(c.overview.totalRealizedR)}
                    </span>
                    <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Total Realized R</span>
                  </div>
                  <Donut
                    size={96}
                    stroke={12}
                    segments={[
                      { label: "Win", value: c.overview.winningTrades, color: "var(--success)" },
                      { label: "Loss", value: c.overview.losingTrades, color: "var(--danger)" },
                      { label: "BE", value: c.overview.breakevenTrades, color: "var(--muted-foreground)" },
                    ]}
                  >
                    <span className="text-lg font-semibold tabular-nums">{c.overview.totalExecutedTrades}</span>
                    <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Trades</span>
                  </Donut>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <KpiCard
                    label="Total Realized R"
                    value={fmtR(c.overview.totalRealizedR)}
                    sublabel={fmtUsd(c.overview.totalPnl)}
                    tone={rTone(c.overview.totalRealizedR)}
                    size="lg"
                    className="col-span-2"
                  />
                  <KpiCard
                    label="Win Rate"
                    value={c.overview.winRate != null ? `${c.overview.winRate.toFixed(0)}%` : "—"}
                    sublabel={`n=${c.overview.finalizedTrades}`}
                  />
                  <KpiCard label="Profit Factor" value={ratio(c.overview.profitFactor)} />
                  <KpiCard label="Expectancy" value={fmtR(c.overview.expectancy)} tone={rTone(c.overview.expectancy)} />
                  <KpiCard label="Avg Win R" value={fmtR(c.overview.averageWinnerR)} tone="success" />
                  <KpiCard label="Avg Loss R" value={fmtR(c.overview.averageLoserR)} tone="danger" />
                  <KpiCard
                    label="Executed Trades"
                    value={String(c.overview.totalExecutedTrades)}
                    sublabel={`${c.overview.cancelledCount} cancelled`}
                  />
                  <KpiCard
                    label="Override Rate"
                    value={c.overview.overrideRate != null ? `${c.overview.overrideRate.toFixed(0)}%` : "—"}
                    tone={c.overview.overrideCount > 0 ? "danger" : "neutral"}
                  />
                  <KpiCard label="Longest Win Streak" value={String(c.overview.longestWinStreak)} tone="success" />
                  <KpiCard label="Longest Loss Streak" value={String(c.overview.longestLossStreak)} tone="danger" />
                  <KpiCard label="Avg Trades / Day" value={d.averageTradesPerDay.toFixed(2)} />
                  {/* PnL — secondary, monetary, from the Performance Account ledger. */}
                  <KpiCard label="Net P&L" value={moneySigned(d.netPnl)} tone={toneOf(d.netPnl)} />
                  <KpiCard label="Gross Profit" value={money(d.grossProfit)} tone="success" />
                  <KpiCard label="Gross Loss" value={money(d.grossLoss)} tone="danger" />
                  <KpiCard label="Largest Win" value={money(d.largestWin)} tone="success" />
                  <KpiCard label="Largest Loss" value={money(d.largestLoss)} tone="danger" />
                </div>
              </section>
            </StaggerItem>

            {/* Performance Curve — cumulative realized R (trader performance) */}
            <StaggerItem>
              <section id="section-performance-curve" className="scroll-mt-24 space-y-3">
                <SectionHeading
                  title="Performance Curve"
                  hint="cumulative realized R — cancelled ideas excluded, partials counted once"
                  icon={TrendingUp}
                />
                <div className="glass rounded-2xl p-4">
                  <RCurveChart curve={c.cumulativeRCurve} />
                </div>
              </section>
            </StaggerItem>

            {/* Account Equity — monetary balance (account accounting, not trader performance) */}
            <StaggerItem>
              <section id="section-account-equity" className="scroll-mt-24 space-y-3">
                <SectionHeading title="Account Equity" hint="monetary balance of the Performance Account" icon={Wallet} />
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
            </StaggerItem>

            {/* Discrepancy Gap (execution discrepancy) + Planned vs Actual (review aid — NOT a discrepancy) */}
            <StaggerItem>
              <div id="section-discrepancy" className="scroll-mt-24 space-y-4">
                <DiscrepancyAnalytics
                  curve={d.counterfactual.curve}
                  summary={summary}
                  avgStrategyAdherence={d.adherence.avgTradeQuality}
                  avgRuleAdherence={d.ruleAdherenceAverage}
                />
                <Card
                  title="Planned vs Actual"
                  hint="a review aid, separate from the Discrepancy Engine above — a correctly-executed loss is normal variance, not a discrepancy"
                >
                  {c.plannedVsActual.sampleSize === 0 ? (
                    <p className="text-xs text-muted-foreground/60 italic">
                      No fully-closed trades with both a confirmed plan and a determined result yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-0.5">
                        <div className="text-[11px] text-muted-foreground">Avg planned R</div>
                        <div className="text-sm font-semibold tabular-nums">{fmtR(c.plannedVsActual.averagePlannedR)}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] text-muted-foreground">Avg realized R</div>
                        <div className={cn("text-sm font-semibold tabular-nums", rTone(c.plannedVsActual.averageRealizedR) === "success" ? "text-success" : "text-danger")}>
                          {fmtR(c.plannedVsActual.averageRealizedR)}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] text-muted-foreground">Gap (realized − planned)</div>
                        <div className={cn("text-sm font-semibold tabular-nums", rTone(c.plannedVsActual.averageGap) === "success" ? "text-success" : "text-danger")}>
                          {fmtR(c.plannedVsActual.averageGap)}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] text-muted-foreground">Met/exceeded plan</div>
                        <div className="text-sm font-semibold tabular-nums">
                          {c.plannedVsActual.meetOrExceedRate != null ? `${c.plannedVsActual.meetOrExceedRate.toFixed(0)}%` : "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </StaggerItem>

            {/* Strategy, Setup Type & Asset performance (frozen historical identity) */}
            <StaggerItem>
              <section id="section-strategy" className="scroll-mt-24 space-y-3">
                <SectionHeading
                  title="Strategy, Setup Type & Asset"
                  hint="frozen historical identity — never re-derived from live Strategy Lab config"
                  icon={Layers}
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="By strategy">
                    <GroupList stats={c.byStrategy} emptyLabel="No strategy-linked trades in this range." />
                  </Card>
                  <Card title="By Setup Type">
                    <GroupList stats={c.bySetupType} emptyLabel="No Setup Type used in this range." />
                  </Card>
                </div>
                <Card title="By asset">
                  <GroupList stats={c.byAsset} emptyLabel="No trades in this range yet." />
                </Card>
              </section>
            </StaggerItem>

            {/* Strategy Adherence + Confluences, plus Validated/Overridden and Daily Bias alignment */}
            <StaggerItem>
              <div id="section-adherence" className="scroll-mt-24 space-y-4">
                <AdherenceAnalytics data={d.adherence} />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card title="Validated vs Overridden">
                    <GroupList stats={c.byValidationState} emptyLabel="No Setup Type used in this range." />
                    {c.byOverrideReason.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase">By override reason</span>
                        <GroupList stats={c.byOverrideReason} emptyLabel="No overrides." />
                      </div>
                    )}
                  </Card>
                  <Card title="Daily Bias Alignment" hint="observational — alignment isn't inherently correct">
                    <GroupList stats={c.byBiasAlignment} emptyLabel="No daily-bias data in this range." />
                  </Card>
                </div>
              </div>
            </StaggerItem>

            {/* Weekday / month / direction / session / hour / risk breakdowns */}
            <StaggerItem>
              <div id="section-breakdowns" className="scroll-mt-24">
                <AnalyticsBreakdowns trading={d} canonical={c} />
              </div>
            </StaggerItem>

            {/* Behavioral analytics: psychology questionnaire + behaviour labels + mood */}
            <StaggerItem>
              <section id="section-behavioral" className="scroll-mt-24 space-y-4">
                <SectionHeading title="Behavioral Analytics" hint="historical patterns — not causation" icon={Brain} />
                <PsychologyAnalytics data={psychology} />
                <Card title="Behaviour Label Performance" hint="what behaviours co-occur with the biggest R gains/costs — correlation, not causation">
                  <BehaviourLists stats={c.byBehaviourLabel} />
                </Card>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card title="Pre-Trade Mood Performance">
                    <GroupList stats={c.byMoodTag} emptyLabel="No mood tags recorded in this range." />
                  </Card>
                  <Card title="Mood Intensity vs Performance" hint="1 (low) – 5 (high)">
                    <GroupList stats={c.byMoodIntensity} emptyLabel="No mood intensity recorded." />
                  </Card>
                </div>
              </section>
            </StaggerItem>

            {/* Daily account return heatmap */}
            <StaggerItem>
              <section id="section-daily" className="scroll-mt-24 space-y-3">
                <SectionHeading title="Daily Account Return" hint="% of balance per day — account accounting, not R" icon={CalendarDays} />
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
            </StaggerItem>

            {/* Opportunity Funnel — Edge Capture + Leakage vs Missed split */}
            <StaggerItem>
              <section id="section-opportunity" className="scroll-mt-24 space-y-3">
                <SectionHeading
                  title="Opportunity & Edge Capture"
                  hint="from tracked opportunities — separate from realized P&L"
                  icon={Target}
                />
                <OpportunityAnalytics data={d.opportunity} />
              </section>
            </StaggerItem>
          </>
        )}
      </StaggerList>
    </div>
  );
}
