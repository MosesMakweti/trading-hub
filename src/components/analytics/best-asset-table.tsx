import { cn } from "@/lib/utils";
import type { AssetStats } from "@/domain/performance/metrics";

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
            <th className="py-2 pr-4 text-right font-normal">Win Rate</th>
            <th className="py-2 pr-4 text-right font-normal">Avg RR</th>
            <th className="py-2 text-right font-normal">Total Return</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.assetSymbol} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 font-medium">{s.assetSymbol}</td>
              <td className="py-2 pr-4 text-right text-muted-foreground tabular-nums">{s.totalTrades}</td>
              <td className="py-2 pr-4 text-right text-muted-foreground tabular-nums">
                {s.winRate == null ? "—" : `${s.winRate.toFixed(1)}%`}
              </td>
              <td className="py-2 pr-4 text-right text-muted-foreground tabular-nums">
                {s.averageRR == null ? "—" : `${s.averageRR.toFixed(2)}R`}
              </td>
              <td
                className={cn(
                  "py-2 text-right font-medium tabular-nums",
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
