import { Tag, colorForName } from "@/components/ui/tag";
import { AdherenceMeter } from "@/components/journal/adherence-score";
import { SetupScoreCard } from "@/components/journal/setup-score-card";
import {
  NoteBlock,
  StrategyRef,
  WorkspaceField,
} from "@/components/journal/workspace/workspace-ui";
import { WorkspaceNoteField } from "@/components/journal/workspace/workspace-fields";
import { TradeImageBucket } from "@/components/journal/workspace/trade-image-bucket";
import { AccountAllocationSection } from "@/components/journal/workspace/account-allocation-section";
import { TradePlanSection } from "@/components/journal/workspace/trade-plan/trade-plan-section";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";

// Section 1 — Trade Idea: what the trader planned, before the trade.
export function TradeIdeaSection({
  trade,
  propFirmAccounts,
  executions,
}: {
  trade: TradeWorkspaceDTO;
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executions: ExecutionDTO[];
}) {
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
          value={
            trade.entryModelName ? (
              <Tag color={colorForName(trade.entryModelName)}>{trade.entryModelName}</Tag>
            ) : undefined
          }
          placeholder="None"
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
          label="Higher-timeframe bias"
          value={`${trade.higherTimeframeBias === "BULLISH" ? "Bullish" : "Bearish"} · ${trade.biasConfidencePercent}%`}
        />
        <WorkspaceField
          label="Expected RR"
          value={trade.expectedRR != null ? `${trade.expectedRR.toFixed(2)}R` : undefined}
          placeholder="Not planned yet"
        />
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
        {(trade.setupValid !== null || trade.setupScore != null) && (
          <SetupScoreCard
            score={trade.setupScore}
            rating={trade.setupRating}
            valid={trade.setupValid}
            missingMandatory={trade.missingMandatory}
            className="max-w-md"
          />
        )}
        <AdherenceMeter label="Confluence adherence" percent={trade.confluencePercent} className="max-w-xs" />
      </div>

      <NoteBlock label="Pre-trade notes" text={trade.preTradeNotes} />

      {/* Trade plan details — entry/stop-loss/target now live solely in the
          TradingView Trade Plan below (screenshot + annotations); this block
          only holds narrative context that isn't part of that architecture. */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-3">
        <div className="text-xs font-medium text-muted-foreground sm:col-span-3">
          Trade plan details
        </div>
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

      <TradePlanSection
        dateKey={trade.dateKey}
        tradeId={trade.id}
        assetSymbol={trade.assetSymbol}
        initialDirection={trade.direction}
        tradeUpdatedAt={trade.updatedAt}
      />

      {/* Before-Trade images — what the trader saw/planned before entering: chart
          setup, market structure, areas of interest, planned setup. The plan
          screenshot above (once attached) also appears here automatically —
          both stay connected to the same Trade Idea. */}
      <div className="space-y-2 rounded-xl border border-border bg-background/30 p-3">
        <TradeImageBucket tradeId={trade.id} category="BEFORE" label="Before-Trade Images" />
      </div>

      <AccountAllocationSection tradeId={trade.id} propFirmAccounts={propFirmAccounts} executions={executions} />
    </div>
  );
}
