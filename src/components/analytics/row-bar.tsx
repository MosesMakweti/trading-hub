import { cn } from "@/lib/utils";

/**
 * A single-hue magnitude bar for an in-table cell — win rate, score, or any
 * other 0–100 metric. Matches the dataviz "sequential = one hue" rule; used
 * anywhere a table would otherwise show the same number a nearby chart
 * already renders as a bar, so the table stops being a plain unenhanced
 * restatement of it.
 */
export function RowBar({
  percent,
  label,
  className,
  barClassName,
}: {
  /** 0–100. Null renders an empty track with an em-dash label. */
  percent: number | null;
  /** Overrides the default `{percent}%` label. */
  label?: string;
  className?: string;
  barClassName?: string;
}) {
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full bg-viz-1", barClassName)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {label ?? (percent == null ? "—" : `${percent.toFixed(0)}%`)}
      </span>
    </div>
  );
}
