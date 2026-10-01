"use client";

import { cn } from "@/lib/utils";
import { fmtR, fmtUsd, tone } from "@/lib/analytics-format";
import { MIN_EXPECTANCY_SAMPLE } from "@/domain/performance/expectancy";
import { MarkTooltip } from "@/components/viz/mark-tooltip";
import { VIZ } from "@/components/viz/tokens";
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
 *  setup-type/asset/direction/session/bias-alignment/mood breakdown.
 *
 *  The bar is DIVERGING around a zero axis on a scale shared by the whole
 *  list: losses grow left in loss ink, gains grow right in profit ink, so
 *  sign and relative size read at a glance and groups compare honestly.
 *  Win rate gets its own small meter (with a 50% tick); a below-threshold
 *  sample is dimmed. Hover/focus shows every stat the service computed for
 *  the group, plus its share of the list's net R. Presentation only. */
export function GroupRow({
  stat,
  maxAbsR,
  showPnl = true,
  netR,
}: {
  stat: RGroupStats;
  maxAbsR: number;
  showPnl?: boolean;
  /** Σ totalR across the list — for the tooltip's contribution line. */
  netR?: number;
}) {
  if (stat.count === 0) {
    // A group with no executed trades in range: kept so the trader sees it
    // exists, collapsed so it doesn't read as data.
    return (
      <div className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground/60">
        <span className="truncate">{stat.label}</span>
        <span>no trades in range</span>
      </div>
    );
  }
  const half = maxAbsR > 0 ? Math.min(50, (Math.abs(stat.totalR) / maxAbsR) * 50) : 0;
  const t = tone(stat.totalR);
  const small = stat.finalizedCount < MIN_EXPECTANCY_SAMPLE;
  const model = {
    title: stat.label,
    subtitle: `${stat.count} executed · ${stat.finalizedCount} settled${small && stat.finalizedCount > 0 ? " · small sample" : ""}`,
    rows: [
      { key: "tot", label: "Total R", value: fmtR(stat.totalR), color: t === "danger" ? VIZ.loss : t === "success" ? VIZ.profit : VIZ.neutral, mark: "swatch" as const, tone: polar(stat.totalR) },
      { key: "avg", label: "Average R", value: fmtR(stat.averageR), tone: polar(stat.averageR), mark: "none" as const },
      { key: "exp", label: "Expectancy", value: fmtR(stat.expectancy), tone: polar(stat.expectancy), mark: "none" as const },
      { key: "wr", label: "Win rate", value: stat.winRate != null ? `${stat.winRate.toFixed(0)}%` : "—", mark: "none" as const },
      { key: "pf", label: "Profit factor", value: stat.profitFactor != null ? stat.profitFactor.toFixed(2) : "—", mark: "none" as const },
      ...(showPnl ? [{ key: "pnl", label: "P&L", value: fmtUsd(stat.totalPnl), tone: polar(stat.totalPnl), mark: "none" as const }] : []),
      ...(netR != null && Math.abs(netR) > 0.005
        ? [{ key: "share", label: "Of list net R", value: `${fmtR(stat.totalR)} of ${fmtR(netR)}`, tone: "muted" as const, mark: "none" as const, separated: true }]
        : []),
    ],
  };
  return (
    <MarkTooltip model={model}>
      <div
        tabIndex={0}
        aria-label={`${stat.label}: ${fmtR(stat.totalR)}, win rate ${stat.winRate != null ? `${stat.winRate.toFixed(0)}%` : "not available"}, ${stat.finalizedCount} settled trades`}
        className={cn(
          "-mx-2 space-y-1.5 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
          small && "opacity-80",
        )}
      >
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate font-medium">{stat.label}</span>
          <div className="flex shrink-0 items-center gap-2">
            <SampleTag count={stat.finalizedCount} />
            <span
              className={cn(
                "w-16 text-right font-semibold tabular-nums",
                t === "success" ? "text-success" : t === "danger" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {fmtR(stat.totalR)}
            </span>
          </div>
        </div>
        {/* Diverging bar: the centre hairline is 0R. */}
        <div className="relative h-2 w-full rounded-full bg-muted/70" aria-hidden>
          <div className="absolute inset-y-[-2px] left-1/2 w-px bg-viz-axis" />
          {half > 0 && (
            <div
              className={cn("absolute inset-y-0", stat.totalR >= 0 ? "left-1/2 rounded-r-full bg-viz-profit" : "right-1/2 rounded-l-full bg-viz-loss")}
              style={{ width: `${half}%` }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="tabular-nums">avg {fmtR(stat.averageR)}</span>
          <span className="flex items-center gap-1.5">
            <span className="relative h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full bg-viz-1" style={{ width: `${Math.max(0, Math.min(100, stat.winRate ?? 0))}%` }} />
              <span className="absolute inset-y-0 left-1/2 w-px bg-card" />
            </span>
            <span className="tabular-nums">{stat.winRate != null ? `${stat.winRate.toFixed(0)}%` : "—"} win</span>
          </span>
          <span className="tabular-nums">exp {fmtR(stat.expectancy)}</span>
          {showPnl && <span className="ml-auto tabular-nums">{fmtUsd(stat.totalPnl)}</span>}
        </div>
      </div>
    </MarkTooltip>
  );
}

function polar(n: number | null): "profit" | "loss" | "muted" | undefined {
  if (n == null) return undefined;
  return n > 0 ? "profit" : n < 0 ? "loss" : "muted";
}

/** `showPnl=false` for R-only datasets (Backtesting). */
export function GroupList({ stats, emptyLabel, showPnl = true }: { stats: RGroupStats[]; emptyLabel: string; showPnl?: boolean }) {
  const withData = stats.filter((s) => s.count > 0);
  if (withData.length === 0) {
    return <p className="text-xs text-muted-foreground/60 italic">{emptyLabel}</p>;
  }
  const maxAbsR = Math.max(...withData.map((s) => Math.abs(s.totalR)), 0.001);
  const netR = withData.reduce((sum, s) => sum + s.totalR, 0);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-0 text-[10px] tracking-wide text-muted-foreground/70 uppercase" aria-hidden>
        <span>Loss</span>
        <span>0R</span>
        <span>Gain</span>
      </div>
      {stats.map((s) => (
        <GroupRow key={s.key} stat={s} maxAbsR={maxAbsR} showPnl={showPnl} netR={netR} />
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
