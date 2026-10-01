import { LineChart } from "lucide-react";

import { KpiCard } from "@/components/analytics/kpi-card";
import { CompositionBar } from "@/components/viz/composition-bar";
import { VIZ } from "@/components/viz/tokens";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";

function pct(n: number | null) {
  return n == null ? "—" : `${n.toFixed(0)}%`;
}
function rr(n: number | null) {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

/**
 * Per-strategy performance. Stage 10.5: every R number here comes from the
 * canonical, R-primary dataset (`toStrategyPerformanceSummary`) — a real
 * R-multiple, not the legacy Performance Account contribution %.
 */
export function StrategyPerformanceSection({
  performance,
}: {
  performance: StrategyPerformanceSummary;
}) {
  const p = performance;

  if (p.totalTrades === 0) {
    return (
      <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl p-10 text-center">
        <LineChart className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">No trades reference this strategy yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Link a trade to this strategy from the Journal (the Strategy field on the trade form)
          and its win rate, R, psychology, and adherence will appear here.
        </p>
      </div>
    );
  }

  const returnTone = (n: number | null): "success" | "danger" | undefined =>
    n == null ? undefined : n >= 0 ? "success" : "danger";

  const other = Math.max(0, p.totalTrades - p.winningTrades - p.losingTrades);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Across <span className="font-medium text-foreground">{p.totalTrades}</span> trade
        {p.totalTrades === 1 ? "" : "s"} taken under this strategy. R is each trade&apos;s realized
        R-multiple.
      </p>

      <div className="glass grid gap-5 rounded-2xl p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Outcomes</div>
          <CompositionBar
            parts={[
              { key: "w", label: "Wins", value: p.winningTrades, color: VIZ.profit },
              { key: "l", label: "Losses", value: p.losingTrades, color: VIZ.loss },
              { key: "o", label: "Breakeven / open", value: other, color: VIZ.neutral },
            ]}
          />
        </div>
        <RangeStrip worst={p.worstRR} best={p.bestRR} average={p.averageRR} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Win rate" value={pct(p.winRate)} sublabel={`${p.winningTrades}W · ${p.losingTrades}L`} meter={{ value: p.winRate, reference: 50 }} />
        <KpiCard label="Total realized R" value={rr(p.totalRR)} tone={returnTone(p.totalRR) ?? "neutral"} />
        <KpiCard label="Avg R / trade" value={rr(p.averageRR)} tone={returnTone(p.averageRR) ?? "neutral"} />
        <KpiCard label="Expectancy" value={rr(p.expectancy)} tone={returnTone(p.expectancy) ?? "neutral"} />
        <KpiCard
          label="Profit factor"
          value={p.profitFactor == null ? "—" : p.profitFactor.toFixed(2)}
          tone={p.profitFactor == null ? "neutral" : p.profitFactor >= 1 ? "success" : "danger"}
        />
        <KpiCard label="Streaks" value={`${p.longestWinStreak}W`} sublabel={`Longest loss ${p.longestLossStreak}L`} />
        <KpiCard
          label="Avg psychology"
          value={p.averagePsychologyPercent == null ? "—" : `${p.averagePsychologyPercent.toFixed(0)}%`}
          meter={{
            value: p.averagePsychologyPercent,
            tone: p.averagePsychologyPercent == null ? "brand" : p.averagePsychologyPercent >= 80 ? "success" : p.averagePsychologyPercent >= 60 ? "warning" : "danger",
          }}
        />
        <KpiCard
          label="Avg adherence"
          value={p.averageAdherencePercent == null ? "—" : `${p.averageAdherencePercent.toFixed(0)}%`}
          meter={{ value: p.averageAdherencePercent }}
        />
      </div>
    </div>
  );
}

/** Worst → best trade on one zero axis, average R marked — the strategy's
 *  outcome range at a glance (all three numbers are the summary's own). */
function RangeStrip({ worst, best, average }: { worst: number | null; best: number | null; average: number | null }) {
  const scale = Math.max(Math.abs(worst ?? 0), Math.abs(best ?? 0), 0.01);
  const pos = (v: number) => 50 + (v / scale) * 50;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-muted-foreground">Trade range</span>
        <span className="text-muted-foreground tabular-nums">avg {rr(average)}</span>
      </div>
      <div className="relative h-3 rounded-full bg-muted/70" aria-hidden>
        {worst != null && worst < 0 && (
          <div className="absolute inset-y-0 rounded-l-full bg-viz-loss/70" style={{ left: `${pos(worst)}%`, right: "50%" }} />
        )}
        {best != null && best > 0 && (
          <div className="absolute inset-y-0 rounded-r-full bg-viz-profit/70" style={{ left: "50%", right: `${100 - pos(best)}%` }} />
        )}
        <div className="absolute inset-y-[-3px] left-1/2 w-px bg-viz-axis" />
        {average != null && (
          <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: `${pos(average)}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums">
        <span className="text-danger">worst {rr(worst)}</span>
        <span className="text-muted-foreground">0R</span>
        <span className="text-success">best {rr(best)}</span>
      </div>
    </div>
  );
}
