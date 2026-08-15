import Link from "next/link";
import { LineChart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { ExecutionDTO } from "@/types/prop-firms";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  PLANNED: "outline",
  OPEN: "secondary",
  CLOSED: "default",
  CANCELLED: "outline",
};

export function TradesTab({ executions }: { executions: ExecutionDTO[] }) {
  if (executions.length === 0) {
    return (
      <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center">
        <LineChart className="size-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">No trade allocations yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Allocate a Trade Idea to this account from the Journal to see its executions here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {executions.map((execution) => (
        <Link
          key={execution.id}
          href={`/journal/${execution.tradeDate}/trades/${execution.tradeId}`}
          className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5 transition-colors hover:bg-muted/40"
        >
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              {execution.assetSymbol}
              <Badge variant="outline">{execution.direction}</Badge>
              <Badge variant={STATUS_VARIANT[execution.status] ?? "secondary"}>{execution.status}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {execution.tradeDate} · {execution.stageName} · Risk {formatCurrency(execution.plannedRiskAmount)}
              {execution.plannedR != null && ` · Planned ${execution.plannedR.toFixed(1)}R`}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-sm font-medium ${execution.netPnl != null && execution.netPnl !== 0 ? (execution.netPnl > 0 ? "text-success" : "text-danger") : ""}`}>
              {execution.netPnl != null ? formatSignedCurrency(execution.netPnl) : "—"}
              {execution.isPnlEstimated && <span className="ml-1 text-[10px] font-normal text-muted-foreground italic">est.</span>}
            </div>
            {execution.actualR != null && (
              <div className="text-xs text-muted-foreground">{execution.actualR >= 0 ? "+" : ""}{execution.actualR.toFixed(2)}R</div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
