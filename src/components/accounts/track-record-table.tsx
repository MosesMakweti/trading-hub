import { cn } from "@/lib/utils";
import { formatDateKeyLong } from "@/lib/date";
import type { AccountTrackRecordEntryDTO } from "@/types/accounts";

function currency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function TrackRecordTable({
  entries,
  limit,
}: {
  entries: AccountTrackRecordEntryDTO[];
  limit?: number;
}) {
  const shown = limit ? entries.slice(-limit).reverse() : [...entries].reverse();

  if (shown.length === 0) {
    return <p className="text-xs text-muted-foreground">No trades recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">Date</th>
            <th className="py-1.5 pr-3 font-normal">Asset</th>
            <th className="py-1.5 pr-3 font-normal">Dir</th>
            <th className="py-1.5 pr-3 text-right font-normal">Risk</th>
            <th className="py-1.5 pr-3 text-right font-normal">PnL</th>
            <th className="py-1.5 text-right font-normal">Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.tradeId} className="border-b border-border/50 last:border-0">
              <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                {formatDateKeyLong(e.dateKey).replace(/^\w+, /, "")}
              </td>
              <td className="py-1.5 pr-3 font-medium">{e.assetSymbol}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">
                {e.direction === "LONG" ? "Long" : "Short"}
              </td>
              <td className="py-1.5 pr-3 text-right text-muted-foreground tabular-nums">
                {e.riskValue}
                {e.riskInputType === "PERCENT" ? "%" : "$"}
              </td>
              <td
                className={cn(
                  "py-1.5 pr-3 text-right tabular-nums",
                  e.pnl >= 0 ? "text-success" : "text-danger",
                )}
              >
                {e.pnl >= 0 ? "+" : ""}
                {currency(e.pnl)}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {currency(e.runningBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
