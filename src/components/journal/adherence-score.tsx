import { cn } from "@/lib/utils";

// Strategy-adherence / trade-quality is a discipline score (how closely the trade
// followed its strategy's expected confluences + execution), NOT a market
// prediction. Banded like a grade: strong / partial / weak adherence.
function tone(percent: number) {
  if (percent >= 80) return { bar: "bg-success", text: "text-success" };
  if (percent >= 50) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-danger", text: "text-danger" };
}

/** A labeled thin progress bar for one adherence percentage. Renders nothing when
 * the strategy defined no items of this kind (percent is null). */
export function AdherenceMeter({
  label,
  percent,
  className,
}: {
  label: string;
  percent: number | null;
  className?: string;
}) {
  if (percent == null) return null;
  const t = tone(percent);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", t.text)}>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", t.bar)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Compact trade-quality pill for dense lists (trade cards). */
export function TradeQualityBadge({ percent }: { percent: number | null }) {
  if (percent == null) return null;
  const t = tone(percent);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        "border-border bg-background/40",
        t.text,
      )}
      title="Strategy adherence — how closely this trade followed its strategy"
    >
      <span className={cn("size-1.5 rounded-full", t.bar)} />
      {percent}% adherence
    </span>
  );
}
