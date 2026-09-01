import Link from "next/link";
import { Wallet } from "lucide-react";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * The master ledger — every other dashboard number derives from this account
 * (see [[project-account-trade-track-record]]) — so it gets its own visually
 * distinct, brand-accented card, never grouped into the prop-firm cards grid.
 */
export function PerformanceAccountCard({
  currentBalance,
  netPnl,
  winRate,
  profitFactor,
}: {
  currentBalance: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
}) {
  return (
    <Link
      href="/accounts"
      className="glass-strong block space-y-2.5 rounded-lg border-primary/30 p-3.5 transition-colors hover:bg-accent/30"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Wallet className="size-3.5 text-primary" />
          Performance Account
        </div>
        <span className="money text-lg font-semibold tabular-nums">{currency(currentBalance)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Net PnL</div>
          <span className={`money tabular-nums font-medium ${netPnl >= 0 ? "text-success" : "text-danger"}`}>
            {netPnl >= 0 ? "+" : ""}
            {currency(netPnl)}
          </span>
        </div>
        <div>
          <div className="text-muted-foreground">Win rate</div>
          <div className="tabular-nums font-medium">{winRate == null ? "—" : `${winRate.toFixed(0)}%`}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Profit factor</div>
          <div className="tabular-nums font-medium">{profitFactor == null ? "—" : profitFactor.toFixed(2)}</div>
        </div>
      </div>
    </Link>
  );
}
