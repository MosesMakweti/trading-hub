import { Sparkline } from "@/components/analytics/sparkline";

/** Compact balance trend for account cards. Rendered by the shared SVG
 *  Sparkline (per-instance gradient ids, so several cards on one page each
 *  keep their own profit/loss tint — the previous Recharts version shared one
 *  hard-coded gradient id across every card). Green when the balance ends at
 *  or above where it started, red otherwise. */
export function MiniEquityCurve({
  points,
  className,
}: {
  points: { balance: number }[];
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground">Not enough trade history yet.</p>
      </div>
    );
  }
  return (
    <div className={className}>
      <Sparkline values={points.map((p) => p.balance)} width={240} height={48} className="w-full" />
    </div>
  );
}
