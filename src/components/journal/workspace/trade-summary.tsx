import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import {
  StrategyRef,
  formatRR,
  formatSignedCurrency,
} from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}

// At-a-glance recap of the whole trade.
export function TradeSummary({ trade }: { trade: TradeWorkspaceDTO }) {
  const lessonsCount = [trade.postTradeReflection, trade.lessonsLearned, trade.whatToWorkOn].filter(
    Boolean,
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Stat label="Result">
        {trade.actualRR == null ? (
          <span className="text-muted-foreground">Open</span>
        ) : (
          <span
            className={cn(
              "tabular-nums",
              trade.actualRR >= 0 ? "text-success" : "text-danger",
            )}
          >
            {formatRR(trade.actualRR)} · {formatSignedCurrency(trade.performancePnlNet)}
          </span>
        )}
      </Stat>
      <Stat label="Strategy">
        {trade.strategyName ? (
          <StrategyRef
            strategyId={trade.strategyId}
            name={trade.strategyName}
            version={trade.strategyVersion}
            showVersion={false}
          />
        ) : (
          <span className="text-muted-foreground/40 italic">None</span>
        )}
      </Stat>
      <Stat label="Strategy version">
        {trade.strategyVersion != null ? (
          <span className="tabular-nums">v{trade.strategyVersion}</span>
        ) : (
          <span className="text-muted-foreground/40 italic">—</span>
        )}
      </Stat>
      <Stat label="Entry model">
        {trade.entryModelName ? (
          trade.entryModelName
        ) : (
          <span className="text-muted-foreground/40 italic">None</span>
        )}
      </Stat>
      <Stat label="Psychology">
        {trade.psychology ? (
          <span className="flex items-center gap-1.5">
            <Badge variant={GRADE_VARIANT[trade.psychology.grade]}>{trade.psychology.grade}</Badge>
            {trade.psychology.percent.toFixed(0)}%
          </span>
        ) : (
          <span className="text-muted-foreground/40 italic">—</span>
        )}
      </Stat>
      <Stat label="Strategy adherence">
        {trade.adherencePercent == null ? (
          <span className="text-muted-foreground/40 italic">Not scored</span>
        ) : (
          <span className="tabular-nums">{trade.adherencePercent}%</span>
        )}
      </Stat>
      <Stat label="Lessons">
        {lessonsCount > 0 ? (
          `${lessonsCount} recorded`
        ) : (
          <span className="text-muted-foreground/40 italic">None</span>
        )}
      </Stat>
      <Stat label="Images">
        {trade.images.length > 0 ? (
          `${trade.images.length} attached`
        ) : (
          <span className="text-muted-foreground/40 italic">None</span>
        )}
      </Stat>
    </div>
  );
}
