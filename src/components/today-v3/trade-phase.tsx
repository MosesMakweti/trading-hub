"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OpportunitiesSection } from "@/components/journal/opportunity/opportunities-section";
import type { LinkableTrade } from "@/components/journal/opportunity/opportunity-card";
import { TradeList, type TradeListRow } from "@/components/today-v3/trade/trade-list";
import { TradeLifecycleWorkspace } from "@/components/today-v3/trade/trade-lifecycle-workspace";
import { STATE_SORT, listGroupFor, type TradeStageKey } from "@/domain/trades/trade-lifecycle";
import { loggedBeforeReadiness } from "@/domain/today/day-phase";
import type { DayUsage } from "@/domain/today/limit-state";
import type { TradeLifecycleFactsDTO } from "@/server/services/today-trade.service";
import type { DailyAssetAnalysisDTO, TodaysPlanDTO } from "@/types/today";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";
import type { OpportunityListItemDTO } from "@/types/opportunity";

/**
 * Today V3 — Trade phase: TRADE LIST → TRADE WORKSPACE. Readiness gates
 * starting/taking a trade only; entered positions (today's and carried)
 * are always manageable.
 */
export function TradePhase({
  ready,
  archived,
  dateKey,
  rows,
  lifecycleFacts,
  routineReadyAt,
  selectedId,
  onSelect,
  requestedStage,
  onNewIdea,
  onTakeOpportunity,
  onGoToPrepare,
  strategies,
  analysisFor,
  plan,
  usage,
  limits,
  propFirmAccounts,
  executionsByTradeId,
  opportunities,
  linkableTrades,
}: {
  ready: boolean;
  archived: boolean;
  dateKey: string;
  rows: TradeListRow[];
  lifecycleFacts: Record<string, TradeLifecycleFactsDTO>;
  routineReadyAt: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  requestedStage: { tradeId: string; stage: TradeStageKey } | null;
  onNewIdea: () => void;
  onTakeOpportunity: (o: OpportunityListItemDTO) => void;
  onGoToPrepare: () => void;
  strategies: { id: string; name: string; version: number }[];
  analysisFor: (symbol: string) => DailyAssetAnalysisDTO | null;
  plan: Pick<TodaysPlanDTO, "lookingFor" | "stayOutConditions">;
  usage: DayUsage;
  limits: { riskLimitPercent: number | null; maxTrades: number | null };
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executionsByTradeId: Record<string, ExecutionDTO[]>;
  opportunities: OpportunityListItemDTO[];
  linkableTrades: LinkableTrade[];
}) {
  const [showSetups, setShowSetups] = useState(false);
  const canCreate = ready && !archived;

  // Default selection: the first row in display order (needs-action first).
  const ordered = [...rows].sort((a, b) => {
    const order = ["CARRIED", "ACTIVE", "IDEAS", "DONE"];
    return (
      order.indexOf(listGroupFor(a.lifecycle.state, a.carried)) - order.indexOf(listGroupFor(b.lifecycle.state, b.carried)) ||
      STATE_SORT[a.lifecycle.state] - STATE_SORT[b.lifecycle.state]
    );
  });
  const selected = rows.find((r) => r.trade.id === selectedId) ?? ordered[0] ?? null;
  const missed = opportunities.filter((o) => o.status === "MISSED").length;

  return (
    <div className="space-y-4">
      {!ready && !archived && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm">
            <Lock className="size-4 text-warning" />
            Taking a new trade needs readiness — confirm it in Prepare.
            {rows.some((r) => r.trade.actualEntry != null) && (
              <span className="text-muted-foreground">Open positions stay fully manageable.</span>
            )}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onGoToPrepare}>
            Go to Prepare
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <TradeList
            rows={rows}
            selectedId={selected?.trade.id ?? null}
            onSelect={onSelect}
            canCreate={canCreate}
            lockReason={archived ? "This day is archived" : canCreate ? null : "Confirm readiness in Prepare first"}
            onNewIdea={onNewIdea}
            onSetupMissed={() => setShowSetups((v) => !v)}
            missedCount={missed}
          />
        </aside>

        <div className="min-w-0 space-y-4">
          {showSetups && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <OpportunitiesSection
                dateKey={dateKey}
                opportunities={opportunities}
                strategies={strategies}
                linkableTrades={linkableTrades}
                editable={!archived}
                onTake={canCreate ? onTakeOpportunity : undefined}
              />
            </div>
          )}

          {selected ? (
            <TradeLifecycleWorkspace
              key={`${selected.trade.id}:${requestedStage?.tradeId === selected.trade.id ? requestedStage.stage : ""}`}
              trade={selected.trade}
              lifecycle={selected.lifecycle}
              facts={lifecycleFacts[selected.trade.id]}
              carried={selected.carried}
              loggedBeforeReady={!selected.carried && loggedBeforeReadiness(selected.trade.createdAt, routineReadyAt)}
              initialStage={requestedStage?.tradeId === selected.trade.id ? requestedStage.stage : undefined}
              strategies={strategies}
              analysisFor={analysisFor}
              plan={plan}
              usage={usage}
              limits={limits}
              propFirmAccounts={propFirmAccounts}
              executions={executionsByTradeId[selected.trade.id] ?? []}
            />
          ) : (
            !showSetups && (
              <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                {canCreate
                  ? "Waiting for a setup. Start an idea the moment the market presents one."
                  : "No trades today yet."}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
