import { Tag } from "@/components/ui/tag";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import {
  NoteBlock,
  StrategyRef,
  WorkspaceField,
} from "@/components/journal/workspace/workspace-ui";
import {
  WorkspaceNoteField,
  WorkspacePriceField,
} from "@/components/journal/workspace/workspace-fields";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Section 1 — Trade Idea: what the trader planned, before the trade.
export function TradeIdeaSection({ trade }: { trade: TradeWorkspaceDTO }) {
  const performance = trade.accounts.find((a) => a.kind === "PERFORMANCE");
  const referenceRisk = performance
    ? `${performance.riskValue}% (Performance Account)`
    : undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
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
        <WorkspaceField
          label="Entry model"
          value={trade.entryModelNames.length ? trade.entryModelNames.join(", ") : undefined}
          placeholder="None"
        />
        <WorkspaceField label="Session" value={trade.sessionName} placeholder="No session" />
        <WorkspaceField
          label="Higher-timeframe bias"
          value={`${trade.higherTimeframeBias === "BULLISH" ? "Bullish" : "Bearish"} · ${trade.biasConfidencePercent}%`}
        />
        <WorkspaceField label="Expected RR" value={`${trade.expectedRR.toFixed(2)}R`} />
        <WorkspaceField label="Reference risk" value={referenceRisk} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Confluences</span>
        </div>
        {trade.confluenceLabels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {trade.confluenceLabels.map((tag) => (
              <Tag key={tag.name} color={tag.color}>
                {tag.name}
              </Tag>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">None selected.</p>
        )}
        <AdherenceMeter label="Confluence adherence" percent={trade.confluencePercent} className="max-w-xs" />
      </div>

      <NoteBlock label="Pre-trade notes" text={trade.preTradeNotes} />

      {/* Trade plan details — editable inline (Phase 2). */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-3">
        <div className="text-xs font-medium text-muted-foreground sm:col-span-3">
          Trade plan details
        </div>
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="plannedEntry"
          label="Planned entry"
          initialValue={trade.plannedEntry}
        />
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="plannedStopLoss"
          label="Planned stop-loss"
          initialValue={trade.plannedStopLoss}
        />
        <WorkspacePriceField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="plannedTarget"
          label="Planned target"
          initialValue={trade.plannedTarget}
        />
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="marketContext"
          label="Market context"
          initialValue={trade.marketContext}
          placeholder="What was the higher-timeframe picture?"
          className="sm:col-span-3"
        />
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="areasOfInterest"
          label="Areas of interest"
          initialValue={trade.areasOfInterest}
          placeholder="Key levels / zones you were watching."
          className="sm:col-span-3"
        />
        <WorkspaceNoteField
          dateKey={trade.dateKey}
          tradeId={trade.id}
          field="reasonForTrade"
          label="Reason for trade"
          initialValue={trade.reasonForTrade}
          placeholder="Why did you take this trade?"
          className="sm:col-span-3"
        />
      </div>
    </div>
  );
}
