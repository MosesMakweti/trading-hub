import { Badge } from "@/components/ui/badge";
import {
  ComingSoon,
  NoteBlock,
  WorkspaceField,
} from "@/components/journal/workspace/workspace-ui";
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
        <WorkspaceField label="Strategy" value={<ComingSoon label="Phase 4" />} />
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

      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Confluences</div>
        {trade.confluenceLabels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {trade.confluenceLabels.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">None selected.</p>
        )}
      </div>

      <NoteBlock label="Pre-trade notes" text={trade.preTradeNotes} />

      {/* Planned prices, market context, areas of interest, and reason are new
          fields that a later phase will add to the schema and the editor. */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-border p-3 sm:grid-cols-3">
        <div className="flex items-center gap-2 sm:col-span-3">
          <span className="text-xs font-medium text-muted-foreground">Trade plan details</span>
          <ComingSoon label="Phase 2+" />
        </div>
        <WorkspaceField label="Planned entry" placeholder="—" />
        <WorkspaceField label="Planned stop-loss" placeholder="—" />
        <WorkspaceField label="Planned target" placeholder="—" />
        <WorkspaceField label="Market context" placeholder="—" className="sm:col-span-3" />
        <WorkspaceField label="Areas of interest" placeholder="—" className="sm:col-span-3" />
        <WorkspaceField label="Reason for trade" placeholder="—" className="sm:col-span-3" />
      </div>
    </div>
  );
}
