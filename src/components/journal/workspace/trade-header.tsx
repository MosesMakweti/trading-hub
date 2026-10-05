import { Badge } from "@/components/ui/badge";
import { Tag, colorForName } from "@/components/ui/tag";
import { formatDateKeyLong } from "@/lib/date";
import { tradeTimeDisplay } from "@/domain/trades/display-facts";
import {
  StrategyRef,
  TradeStatusBadge,
  WorkspaceField,
  formatRR,
  formatPerformancePnl,
} from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

export function TradeHeader({ trade }: { trade: TradeWorkspaceDTO }) {
  const time = tradeTimeDisplay({
    executionMinutes: trade.executionMinutes,
    hasActualEntry: trade.actualEntry != null,
    hasLegacyResult: trade.actualEntry == null && trade.actualRR != null,
  });
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
            {formatDateKeyLong(trade.dateKey)} · {time.executed ? time.time : `${time.label} ${time.time}`}
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
            {trade.actualRR == null ? "Pending" : formatRR(trade.actualRR)}
          </div>
          {trade.actualRR != null && (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatPerformancePnl(trade.performancePnlNet)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-4">
        <WorkspaceField
          label="Asset"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Tag color={colorForName(trade.assetSymbol)}>{trade.assetSymbol}</Tag>
              {trade.assetLabel && (
                <span className="text-xs text-muted-foreground">{trade.assetLabel}</span>
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
        <WorkspaceField
          label="Session"
          value={
            trade.sessionName ? (
              <Tag color={trade.sessionColor ?? colorForName(trade.sessionName)}>
                {trade.sessionName}
              </Tag>
            ) : undefined
          }
          placeholder="No session"
        />
        <WorkspaceField
          label="Entry model"
          value={trade.entryModelName ?? undefined}
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
