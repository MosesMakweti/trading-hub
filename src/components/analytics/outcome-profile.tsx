import { cn } from "@/lib/utils";
import { ProgressRing } from "@/components/analytics/progress-ring";
import { CompositionBar } from "@/components/viz/composition-bar";
import { formatR } from "@/components/viz/format";
import { VIZ, tint } from "@/components/viz/tokens";

/**
 * Outcome profile — the "how do my trades end" panel at the top of
 * Analytics: win rate, outcome composition (wins / losses / breakeven /
 * pending), and the payoff shape (average winner vs average loser on one
 * shared zero axis) beside expectancy. Every number is the canonical
 * overview's own (analytics-canonical.service.ts); nothing is derived here
 * beyond bar widths.
 */
export function OutcomeProfile({
  winRate,
  totalRealizedR,
  winning,
  losing,
  breakeven,
  pending,
  averageWinnerR,
  averageLoserR,
  expectancy,
  bestTradeR,
  worstTradeR,
}: {
  winRate: number | null;
  totalRealizedR: number;
  winning: number;
  losing: number;
  breakeven: number;
  pending: number;
  averageWinnerR: number | null;
  averageLoserR: number | null;
  expectancy: number | null;
  bestTradeR: number | null;
  worstTradeR: number | null;
}) {
  const scale = Math.max(Math.abs(averageWinnerR ?? 0), Math.abs(averageLoserR ?? 0), 0.01);
  return (
    <div className="glass grid gap-6 rounded-2xl p-5 lg:grid-cols-[auto_1.4fr_1fr] lg:items-center">
      <div className="flex items-center gap-5">
        <ProgressRing value={winRate} tone="brand" label="Win rate" size={84} />
        <div className="space-y-0.5">
          <div className="text-[11px] tracking-wide text-muted-foreground uppercase">Total realized R</div>
          <div className={cn("text-3xl font-semibold tracking-tight", totalRealizedR > 0 ? "text-success" : totalRealizedR < 0 ? "text-danger" : undefined)}>
            {formatR(totalRealizedR)}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            best {formatR(bestTradeR)} · worst {formatR(worstTradeR)}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Outcomes</div>
        <CompositionBar
          parts={[
            { key: "w", label: "Wins", value: winning, color: VIZ.profit, detail: averageWinnerR != null ? `avg ${formatR(averageWinnerR)}` : undefined },
            { key: "l", label: "Losses", value: losing, color: VIZ.loss, detail: averageLoserR != null ? `avg ${formatR(averageLoserR)}` : undefined },
            { key: "b", label: "Breakeven", value: breakeven, color: VIZ.neutral },
            { key: "p", label: "Pending", value: pending, color: tint(VIZ.neutral, 40), detail: "executed, not yet settled — never counted in win rate" },
          ]}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Payoff</span>
          <span className="text-xs text-muted-foreground">
            expectancy{" "}
            <span className={cn("font-semibold tabular-nums", (expectancy ?? 0) > 0 ? "text-success" : (expectancy ?? 0) < 0 ? "text-danger" : "text-foreground")}>
              {formatR(expectancy)}
            </span>
          </span>
        </div>
        <PayoffBar label="Avg winner" value={averageWinnerR} scale={scale} />
        <PayoffBar label="Avg loser" value={averageLoserR} scale={scale} />
      </div>
    </div>
  );
}

function PayoffBar({ label, value, scale }: { label: string; value: number | null; scale: number }) {
  const half = value == null ? 0 : Math.min(50, (Math.abs(value) / scale) * 50);
  const positive = (value ?? 0) >= 0;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_4rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="relative h-2.5 rounded-full bg-muted/70" aria-hidden>
        <div className="absolute inset-y-[-2px] left-1/2 w-px bg-viz-axis" />
        {half > 0 && (
          <div
            className={cn("absolute inset-y-0", positive ? "left-1/2 rounded-r-full bg-viz-profit" : "right-1/2 rounded-l-full bg-viz-loss")}
            style={{ width: `${half}%` }}
          />
        )}
      </div>
      <span className={cn("text-right font-semibold tabular-nums", value == null ? "text-muted-foreground" : positive ? "text-success" : "text-danger")}>
        {formatR(value)}
      </span>
    </div>
  );
}
