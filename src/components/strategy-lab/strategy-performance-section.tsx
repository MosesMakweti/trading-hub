import { LineChart } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";

function pct(n: number | null) {
  return n == null ? "—" : `${n.toFixed(0)}%`;
}
function rr(n: number | null) {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Across <span className="font-medium text-foreground">{p.totalTrades}</span> trade
        {p.totalTrades === 1 ? "" : "s"} taken under this strategy. R is each trade&apos;s realized
        R-multiple.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label="Win rate"
          value={pct(p.winRate)}
          sub={`${p.winningTrades}W · ${p.losingTrades}L`}
        />
        <Stat label="Avg R / trade" value={rr(p.averageRR)} tone={returnTone(p.averageRR)} />
        <Stat label="Total realized R" value={rr(p.totalRR)} tone={returnTone(p.totalRR)} />
        <Stat
          label="Profit factor"
          value={p.profitFactor == null ? "—" : p.profitFactor.toFixed(2)}
          tone={p.profitFactor == null ? undefined : p.profitFactor >= 1 ? "success" : "danger"}
        />
        <Stat label="Expectancy" value={rr(p.expectancy)} tone={returnTone(p.expectancy)} />
        <Stat label="Best trade" value={rr(p.bestRR)} tone={returnTone(p.bestRR)} />
        <Stat label="Worst trade" value={rr(p.worstRR)} tone={returnTone(p.worstRR)} />
        <Stat
          label="Streaks"
          value={`${p.longestWinStreak}W`}
          sub={`Longest loss ${p.longestLossStreak}L`}
        />
        <Stat
          label="Avg psychology"
          value={p.averagePsychologyPercent == null ? "—" : `${p.averagePsychologyPercent.toFixed(0)}%`}
        />
        <Stat
          label="Avg adherence"
          value={p.averageAdherencePercent == null ? "—" : `${p.averageAdherencePercent.toFixed(0)}%`}
        />
      </div>
    </div>
  );
}
