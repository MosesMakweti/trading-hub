import { cn } from "@/lib/utils";
import type { RunProgress } from "@/domain/backtesting/run-calendar";

/** Completed trading days out of the run's trading days — never calendar days,
 *  and never days merely visited (see run-calendar.ts `isBacktestDayComplete`). */
export function RunProgressBar({ progress, className }: { progress: RunProgress; className?: string }) {
  const pct = Math.round(progress.percentComplete);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{progress.completedTradingDays}</span>
          <span className="tabular-nums"> / {progress.totalTradingDays}</span> trading days completed
        </span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.totalTradingDays}
        aria-valuenow={progress.completedTradingDays}
        aria-label="Trading days completed"
      >
        <div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
