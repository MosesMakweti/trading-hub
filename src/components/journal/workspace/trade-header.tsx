import { Badge } from "@/components/ui/badge";
import { formatDateKeyLong, minutesToTimeString } from "@/lib/date";
import {
  StrategyRef,
  TradeStatusBadge,
  WorkspaceField,
  formatRR,
  formatSignedCurrency,
} from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

export function TradeHeader({ trade }: { trade: TradeWorkspaceDTO }) {
  const resultTone =
    trade.actualRR == null ? "muted" : trade.actualRR >= 0 ? "success" : "danger";

  return (
    <div className="glass space-y-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Trade <span className="font-mono tabular-nums text-primary">#{trade.tradeNumber}</span>
            </h1>
            <TradeStatusBadge status={trade.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateKeyLong(trade.dateKey)} · {minutesToTimeString(trade.executionMinutes)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Result</div>
          <div
            className={
              "text-xl font-semibold tabular-nums " +
              (resultTone === "success"
                ? "text-success"
                : resultTone === "danger"
                  ? "text-danger"
                  : "text-muted-foreground")
            }
          >
            {trade.actualRR == null ? "Open" : formatRR(trade.actualRR)}
          </div>
          {trade.actualRR != null && (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatSignedCurrency(trade.performancePnlNet)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-4">
        <WorkspaceField
          label="Asset"
          value={
            <span className="font-medium">
              {trade.assetSymbol}
              {trade.assetLabel && (
                <span className="ml-1 text-xs text-muted-foreground">{trade.assetLabel}</span>
              )}
            </span>
          }
        />
        <WorkspaceField
          label="Direction"
          value={
            <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
              {trade.direction === "LONG" ? "Long" : "Short"}
            </Badge>
          }
        />
        <WorkspaceField label="Session" value={trade.sessionName} placeholder="No session" />
        <WorkspaceField
          label="Entry model"
          value={trade.entryModelNames.length ? trade.entryModelNames.join(", ") : undefined}
          placeholder="None"
        />
        <WorkspaceField
          label="Strategy"
          value={
            trade.strategyName ? (
              <StrategyRef
                strategyId={trade.strategyId}
                name={trade.strategyName}
                version={trade.strategyVersion}
              />
            ) : undefined
          }
          placeholder="No strategy"
        />
      </div>
    </div>
  );
}
