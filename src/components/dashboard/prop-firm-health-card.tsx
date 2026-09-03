import Link from "next/link";

import { cn } from "@/lib/utils";
import { RuleHealthBadge } from "@/components/prop-firms/rule-health-badge";
import type { PropFirmHealthSummary } from "@/server/services/dashboard.service";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function PropFirmHealthCard({ summary }: { summary: PropFirmHealthSummary }) {
  const balance = summary.currentEquity ?? summary.currentBalance ?? summary.startingBalance;
  const netPnl = balance - summary.startingBalance;

  return (
    <Link
      href={`/prop-firms/${summary.accountId}`}
      className="glass block space-y-2.5 rounded-lg p-3 transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{summary.displayName}</div>
          <div className="text-xs text-muted-foreground">
            {summary.firmName}
            {summary.stageName ? ` · ${summary.stageName}` : ""}
          </div>
        </div>
        <span className="money font-medium tabular-nums">
          <span className={netPnl >= 0 ? "text-success" : "text-danger"}>
            {netPnl >= 0 ? "+" : ""}
            {currency(netPnl)}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {summary.targetRule && <RuleHealthBadge health={summary.targetRule} />}
        {summary.drawdownRule && <RuleHealthBadge health={summary.drawdownRule} />}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Balance</div>
          <div className="money tabular-nums font-medium">{currency(balance)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Payouts</div>
          <div className="money tabular-nums font-medium">{currency(summary.payoutsTotal)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">ROI</div>
          <div className={cn("tabular-nums font-medium", summary.roiPercent != null && (summary.roiPercent >= 0 ? "text-success" : "text-danger"))}>
            {summary.roiPercent == null ? "—" : `${summary.roiPercent >= 0 ? "+" : ""}${summary.roiPercent.toFixed(1)}%`}
          </div>
        </div>
      </div>
    </Link>
  );
}
