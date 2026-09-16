"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardList, ShieldAlert, TrendingDown, TrendingUp, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { RowBar } from "@/components/analytics/row-bar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateKeyShort } from "@/lib/date";
import { ruleKeyLabel } from "@/domain/improvements/commitment-adherence";
import type { AdherenceTrend, ImprovementAnalyticsDTO } from "@/types/edge-improvements";

const TREND_META: Record<AdherenceTrend, { label: string; className: string; Icon: typeof TrendingUp | null }> = {
  IMPROVING: { label: "Improving", className: "text-success", Icon: TrendingUp },
  DECLINING: { label: "Declining", className: "text-danger", Icon: TrendingDown },
  STABLE: { label: "Stable", className: "text-muted-foreground", Icon: null },
  INSUFFICIENT_DATA: { label: "Not enough data", className: "text-muted-foreground/60", Icon: null },
};

/**
 * Analytics → Improvement (Stage 19.1 §14-21) — the longitudinal "did I
 * actually improve" view, distinct from Edge → Improvements' per-period
 * decision surface (§38). Every number is pre-computed by
 * `buildImprovementAnalytics` (the canonical read model, §34) — this
 * component only renders. Weekly/monthly are kept as separate series with a
 * local toggle (§20), matching the existing Psychology Trend chart's own
 * pattern rather than a new global filter (§21). Measures behavioral
 * change, never profitability (§14) — no PnL/R appears anywhere here.
 */
export function AnalyticsImprovementSection({ weekly, monthly }: { weekly: ImprovementAnalyticsDTO; monthly: ImprovementAnalyticsDTO }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const data = mode === "week" ? weekly : monthly;
  const hasAnyData = weekly.rankings.length > 0 || weekly.overview.completedCount > 0 || monthly.rankings.length > 0 || monthly.overview.completedCount > 0;

  if (!hasAnyData) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No improvement commitments yet"
        description="Once you add commitments in Edge → Improvements and log a few days of adherence, this section tracks whether you actually followed through."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Behavioral change over time — never profitability.</p>
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList>
            <TabsTrigger value="week">Weekly</TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Active Commitments" value={String(data.overview.activeCount)} icon={ClipboardList} />
        <KpiCard label="Completed" value={String(data.overview.completedCount)} icon={CheckCircle2} tone="success" />
        <KpiCard label="Improving" value={String(data.overview.improvingCount)} icon={TrendingUp} tone={data.overview.improvingCount > 0 ? "success" : "neutral"} />
        <KpiCard label="Declining" value={String(data.overview.decliningCount)} icon={TrendingDown} tone={data.overview.decliningCount > 0 ? "danger" : "neutral"} />
        <KpiCard
          label="Average Adherence"
          value={data.overview.averageAdherencePercent == null ? "no data" : `${data.overview.averageAdherencePercent}%`}
          sublabel={data.overview.averageAdherenceSampleSize > 0 ? `across ${data.overview.averageAdherenceSampleSize} commitment${data.overview.averageAdherenceSampleSize === 1 ? "" : "s"} with data` : "no commitments with observations yet"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="size-3.5" /> Most Frequently Breached Improvement
          </div>
          {data.mostBreached ? (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm font-semibold">{data.mostBreached.title}</p>
              <p className="text-xs text-muted-foreground">
                {data.mostBreached.breachCount} breach{data.mostBreached.breachCount === 1 ? "" : "es"} out of {data.mostBreached.applicableObservations} observation
                {data.mostBreached.applicableObservations === 1 ? "" : "s"} · {data.mostBreached.adherencePercent}% adherence
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground/60 italic">No breaches recorded {mode === "week" ? "in weekly" : "in monthly"} commitments yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Trophy className="size-3.5" /> Longest-Running Active Commitment
          </div>
          {data.longestRunning ? (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm font-semibold">{data.longestRunning.title}</p>
              <p className="text-xs text-muted-foreground">
                {data.longestRunning.periodsActive} period{data.longestRunning.periodsActive === 1 ? "" : "s"} tracked · first identified {formatDateKeyShort(data.longestRunning.firstIdentifiedDateKey)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground/60 italic">No active commitments {mode === "week" ? "from weekly" : "from monthly"} reviews yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Improving / Declining Commitments</p>
        {data.rankings.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic">No active commitments to rank yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.rankings.map((r) => {
              const meta = TREND_META[r.trend];
              return (
                <div key={r.lineageId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{r.category}</span>
                    <span className="truncate font-medium">{r.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <RowBar percent={r.current.adherencePercent} label={r.current.adherencePercent == null ? "no data" : undefined} />
                    <span className="text-[10px] text-muted-foreground/60">{r.periodsActive}p</span>
                    <span className={cn("flex items-center gap-1 text-[11px] font-medium", meta.className)}>
                      {meta.Icon && <meta.Icon className="size-3" />}
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data.behaviourOccurrence.length > 0 && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Behaviour Occurrence — breaches per period</p>
          <div className="space-y-3">
            {data.behaviourOccurrence.map((series) => (
              <div key={series.ruleKey} className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground/80">{ruleKeyLabel(series.ruleKey)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {series.points.map((p) => (
                    <div key={p.periodStart} className="rounded-md border border-border/60 bg-background/60 px-2 py-1 text-center">
                      <div className="text-[9px] text-muted-foreground/60">{formatDateKeyShort(p.periodStart)}</div>
                      <div className="text-xs font-semibold text-danger">{p.breachCount}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

