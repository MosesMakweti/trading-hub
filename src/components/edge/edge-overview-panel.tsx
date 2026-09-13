import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/analytics/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { CandlestickChart } from "lucide-react";
import type { ReplayActualBaseline } from "@/types/replay";

const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const tone = (v: number | null): "success" | "danger" | undefined =>
  v == null ? undefined : v >= 0 ? "success" : "danger";

/**
 * Edge Review's Overview stage (Stage 12.5 §5-6) — the familiar weekly KPI
 * grid, migrated onto the canonical R-primary baseline (the same one Replay
 * freezes) instead of the legacy Performance-Account contribution-% engine.
 * When no ReplayReviewSession has been started yet, `baseline` is a LIVE
 * preview computed the same way (buildActualBaseline) — never a second
 * calculation, just not frozen yet.
 */
export function EdgeOverviewPanel({ baseline, isLive }: { baseline: ReplayActualBaseline; isLive: boolean }) {
  const { overview } = baseline.canonical;
  const bestAsset = baseline.canonical.byAsset[0] ?? null;

  if (overview.totalExecutedTrades === 0) {
    return (
      <EmptyState
        icon={CandlestickChart}
        title="A quiet period — still worth reviewing"
        description="No trades were executed in this period. A quiet week is still worth reflecting on under Improvements."
      />
    );
  }

  return (
    <div className="space-y-3">
      {isLive && (
        <p className="text-xs text-muted-foreground/70 italic">
          Live preview — start the Replay review to freeze this as the actual baseline.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Trades" value={String(overview.totalExecutedTrades)} sublabel={`${overview.winningTrades}W · ${overview.losingTrades}L · ${overview.breakevenTrades}BE`} />
        <KpiCard label="Win rate" value={pct(overview.winRate)} />
        <KpiCard label="Avg / trade" value={rr(baseline.averageRealizedR)} tone={tone(baseline.averageRealizedR)} />
        <KpiCard label="Total Realized R" value={rr(overview.totalRealizedR)} tone={tone(overview.totalRealizedR)} />
        <KpiCard
          label="Profit factor"
          value={overview.profitFactor == null ? "—" : overview.profitFactor.toFixed(2)}
          tone={overview.profitFactor == null ? undefined : overview.profitFactor >= 1 ? "success" : "danger"}
        />
        <KpiCard label="Expectancy" value={rr(overview.expectancy)} tone={tone(overview.expectancy)} />
        <KpiCard
          label="Avg psychology"
          value={baseline.psychologyAdherence.averagePsychologyPercent == null ? "—" : pct(baseline.psychologyAdherence.averagePsychologyPercent)}
        />
        <KpiCard
          label="Rule adherence"
          value={baseline.psychologyAdherence.averageAdherencePercent == null ? "—" : pct(baseline.psychologyAdherence.averageAdherencePercent)}
        />
        <KpiCard
          label="Best asset"
          value={bestAsset?.label ?? "—"}
          sublabel={bestAsset ? rr(bestAsset.totalR) : undefined}
          tone={bestAsset ? tone(bestAsset.totalR) : undefined}
        />
        <KpiCard label="Cancelled ideas" value={String(overview.cancelledCount)} />
        <KpiCard label="Overrides" value={overview.overrideRate != null ? pct(overview.overrideRate) : "—"} tone={overview.overrideCount > 0 ? "danger" : undefined} />
      </div>

      {baseline.canonical.byStrategy.length > 0 && (
        <div className="glass space-y-2 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-muted-foreground">By strategy</h3>
          <div className="divide-y divide-border/60">
            {baseline.canonical.byStrategy.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="truncate font-medium">{s.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{s.count} trades</span>
                <span className={cn("shrink-0 font-medium tabular-nums", tone(s.totalR) === "success" ? "text-success" : tone(s.totalR) === "danger" ? "text-danger" : "")}>
                  {rr(s.totalR)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
