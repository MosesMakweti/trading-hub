import { cn } from "@/lib/utils";
import type { AssetStats } from "@/domain/performance/metrics";

/**
 * BestAssetTable — per-asset performance with an in-row win-rate meter and a
 * hover state, so the table reads as a ranked leaderboard rather than a grid of
 * numbers. Win rate is shown as a bar (magnitude → single neutral hue) with the
 * value beside it; return keeps its semantic green/red.
 */
export function BestAssetTable({ stats }: { stats: AssetStats[] }) {
  if (stats.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No trades in this range yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Asset</th>
            <th className="py-2 pr-4 text-right font-normal">Trades</th>
            <th className="py-2 pr-4 font-normal">Win Rate</th>
            <th className="py-2 pr-4 text-right font-normal">Avg RR</th>
            <th className="py-2 text-right font-normal">Total Return</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={s.assetSymbol}
              className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/50"
            >
              <td className="py-2.5 pr-4 font-medium">{s.assetSymbol}</td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">{s.totalTrades}</td>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-2"
                      style={{ width: `${Math.max(0, Math.min(100, s.winRate ?? 0))}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.winRate == null ? "—" : `${s.winRate.toFixed(0)}%`}
                  </span>
                </div>
              </td>
              <td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
                {s.averageRR == null ? "—" : `${s.averageRR.toFixed(2)}R`}
              </td>
              <td
                className={cn(
                  "py-2.5 text-right font-medium tabular-nums",
                  s.totalReturnPercent > 0 && "text-success",
                  s.totalReturnPercent < 0 && "text-danger",
                )}
              >
                {s.totalReturnPercent >= 0 ? "+" : ""}
                {s.totalReturnPercent.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
