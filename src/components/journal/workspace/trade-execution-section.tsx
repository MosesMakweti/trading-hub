import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import { cn } from "@/lib/utils";
import { minutesToTimeString } from "@/lib/date";
import {
  WorkspaceField,
  formatRR,
  formatSignedCurrency,
} from "@/components/journal/workspace/workspace-ui";
import {
  WorkspaceNoteField,
  WorkspacePriceField,
} from "@/components/journal/workspace/workspace-fields";
import type { TradeWorkspaceDTO } from "@/types/trades";

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  PERFORMANCE: "Performance",
  PROP_FIRM: "Prop firm",
  PERSONAL_BROKERAGE: "Brokerage",
};

// Section 2 — Trade Execution: what actually happened. Kept separate from the plan.
export function TradeExecutionSection({ trade }: { trade: TradeWorkspaceDTO }) {
  const tpHits = [
    trade.hitTP1 && "TP1",
    trade.hitTP2 && "TP2",
    trade.hitTP3 && "TP3",
    trade.hitFullTP && "Full TP",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <WorkspaceField label="Execution time" value={minutesToTimeString(trade.executionMinutes)} />
        <WorkspaceField
          label="Direction"
          value={
            <Badge variant={trade.direction === "LONG" ? "success" : "danger"}>
              {trade.direction === "LONG" ? "Long" : "Short"}
            </Badge>
          }
        />
        <WorkspaceField
          label="Performance PnL (net)"
          value={
            <span className={trade.performancePnlNet >= 0 ? "text-success" : "text-danger"}>
              {formatSignedCurrency(trade.performancePnlNet)}
            </span>
          }
        />
        <WorkspaceField
          label="Performance PnL (gross)"
          value={formatSignedCurrency(trade.performancePnlGross)}
        />
      </div>

      {/* Planned vs actual RR — the core "did it play out?" comparison. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">Expected RR</div>
          <div className="text-lg font-semibold tabular-nums">{trade.expectedRR.toFixed(2)}R</div>
        </div>
        <div className="text-muted-foreground">→</div>
        <div className="flex-1 text-right">
          <div className="text-xs text-muted-foreground">Actual RR</div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              trade.actualRR == null
                ? "text-muted-foreground"
                : trade.actualRR >= 0
                  ? "text-success"
                  : "text-danger",
            )}
          >
            {trade.actualRR == null ? "Open" : formatRR(trade.actualRR)}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Accounts &amp; risk allocation</div>
        <div className="space-y-1.5">
          {trade.accounts.map((a) => (
            <div
              key={`${a.name}-${a.kind}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <Badge variant="outline">{ACCOUNT_KIND_LABEL[a.kind] ?? a.kind}</Badge>
                <span className="text-xs text-muted-foreground">
                  Risk {a.riskValue}
                  {a.riskInputType === "PERCENT" ? "%" : "$"}
                </span>
              </div>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  a.closingPnlNet >= 0 ? "text-success" : "text-danger",
                )}
              >
                {formatSignedCurrency(a.closingPnlNet)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {(tpHits.length > 0 || trade.executionLabels.length > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {tpHits.map((label) => (
              <Badge key={label} variant="success">
                {label}
              </Badge>
            ))}
            {trade.executionLabels.map((tag) => (
              <Tag key={tag.name} color={tag.color}>
                {tag.name}
              </Tag>
            ))}
          </div>
          <AdherenceMeter
            label="Execution adherence"
            percent={trade.executionPercent}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Combined strategy-adherence / trade-quality — a discipline score, not a
          market prediction. Shown when the trade had a strategy with expected items. */}
      {trade.tradeQualityPercent != null && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Strategy adherence</span>
            <span className="text-xs text-muted-foreground/60">selected vs the strategy&apos;s plan</span>
          </div>
          <AdherenceMeter label="Trade quality" percent={trade.tradeQualityPercent} />
        </div>
      )}

      {/* Execution details — editable inline (Phase 2). */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-2">
        <div className="text-xs font-medium text-muted-foreground sm:col-span-2">
          Execution details
        </div>
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualEntry"
          label="Actual entry"
          initialValue={trade.actualEntry}
        />
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="actualExit"
          label="Actual exit"
          initialValue={trade.actualExit}
        />
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="executionNotes"
          label="Execution notes"
          initialValue={trade.executionNotes}
          placeholder="How did the entry and management actually go?"
          className="sm:col-span-2"
        />
      </div>
    </div>
  );
}
