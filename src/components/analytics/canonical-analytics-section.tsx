"use client";

import { cn } from "@/lib/utils";
import { fmtR, fmtUsd, tone } from "@/lib/analytics-format";
import { MIN_EXPECTANCY_SAMPLE } from "@/domain/performance/expectancy";
import type { RGroupStats, BehaviourLabelStats } from "@/domain/analytics/canonical-aggregations";

/**
 * Stage 10.5 — shared presentation primitives for the canonical (R-primary)
 * analytics dataset. These used to compose one standalone "Realized R
 * Analytics" section; that section has been retired and its widgets
 * redistributed into the main Analytics page structure (Overview,
 * Performance Curve, Strategy & Asset, Adherence, Behavioral, Discrepancy) so
 * there is one coherent page, not "old analytics" + "new analytics". Every
 * number rendered here is a pure presentation of what the service already
 * computed — no chart re-derives its own stats. Correlational, not causal.
 */

/** A small "n=" sample-size tag — a group below the app's existing
 *  expectancy-confidence threshold (MIN_EXPECTANCY_SAMPLE) is visually
 *  dimmed rather than implying false confidence. */
export function SampleTag({ count }: { count: number }) {
  const small = count < MIN_EXPECTANCY_SAMPLE;
  return (
    <span className={cn("text-[10px] tabular-nums", small ? "text-muted-foreground/60" : "text-muted-foreground")}>
      n={count}
      {small && count > 0 && " (small sample)"}
    </span>
  );
}

export function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground/60">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** One row of a grouped-stats list — used for every weekday/month/strategy/
 *  setup-type/asset/direction/session/bias-alignment/mood breakdown. Bar
 *  length is |totalR| relative to the group's max, so the strongest
 *  performer visually reads as the longest bar without implying a fixed
 *  0-100 scale. */
export function GroupRow({ stat, maxAbsR, showPnl = true }: { stat: RGroupStats; maxAbsR: number; showPnl?: boolean }) {
  const widthPercent = maxAbsR > 0 ? Math.min(100, (Math.abs(stat.totalR) / maxAbsR) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{stat.label}</span>
        <div className="flex items-center gap-2">
          <SampleTag count={stat.finalizedCount} />
          <span className={cn("font-semibold tabular-nums", tone(stat.totalR) === "success" ? "text-success" : tone(stat.totalR) === "danger" ? "text-danger" : "text-muted-foreground")}>
            {fmtR(stat.totalR)}
          </span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", stat.totalR >= 0 ? "bg-success" : "bg-danger")}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>avg {fmtR(stat.averageR)}</span>
        <span>win rate {stat.winRate != null ? `${stat.winRate.toFixed(0)}%` : "—"}</span>
        <span>expectancy {fmtR(stat.expectancy)}</span>
        {showPnl && <span className="ml-auto">{fmtUsd(stat.totalPnl)}</span>}
      </div>
    </div>
  );
}

/** `showPnl=false` for R-only datasets (Backtesting). */
export function GroupList({ stats, emptyLabel, showPnl = true }: { stats: RGroupStats[]; emptyLabel: string; showPnl?: boolean }) {
  const withData = stats.filter((s) => s.count > 0);
  if (withData.length === 0) {
    return <p className="text-xs text-muted-foreground/60 italic">{emptyLabel}</p>;
  }
  const maxAbsR = Math.max(...withData.map((s) => Math.abs(s.totalR)), 0.001);
  return (
    <div className="space-y-3">
      {stats.map((s) => (
        <GroupRow key={s.key} stat={s} maxAbsR={maxAbsR} showPnl={showPnl} />
      ))}
    </div>
  );
}

// RCurveChart was retired in Analytics V2 — its cumulativeR series is now
// one of the three modes in the unified EquityCurveChart (R / $ / %),
// rather than a separate chart duplicating the same data.

export function BehaviourLists({ stats, showPnl = true }: { stats: BehaviourLabelStats[]; showPnl?: boolean }) {
  const positive = stats.filter((s) => s.polarity === "POSITIVE" && s.count > 0);
  const negative = stats.filter((s) => s.polarity === "NEGATIVE" && s.count > 0);
  if (positive.length === 0 && negative.length === 0) {
    return <p className="text-xs text-muted-foreground/60 italic">No behaviour labels recorded in this range yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold tracking-wide text-success uppercase">Positive</span>
        <GroupList stats={positive} emptyLabel="None recorded." showPnl={showPnl} />
      </div>
      <div className="space-y-2">
        <span className="text-[11px] font-semibold tracking-wide text-danger uppercase">Negative</span>
        <GroupList stats={negative} emptyLabel="None recorded." showPnl={showPnl} />
      </div>
    </div>
  );
}
