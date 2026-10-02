"use client";

import { CandlestickChart, Compass, Lock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { TodayTradeBar } from "@/components/today/today-trade-bar";
import { AddTradeDialog } from "@/components/today/add-trade-dialog";
import { OpportunitiesSection } from "@/components/journal/opportunity/opportunities-section";
import type { LinkableTrade } from "@/components/journal/opportunity/opportunity-card";
import { TradeIdeaSection } from "@/components/journal/workspace/trade-idea-section";
import { TradeExecutionSection } from "@/components/journal/workspace/trade-execution-section";
import { TradeReviewSection } from "@/components/journal/workspace/trade-review-section";
import type { SessionWindow } from "@/domain/schedule/session-countdown";
import type { DailyAssetAnalysisDTO } from "@/types/today";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";
import type { OpportunityListItemDTO } from "@/types/opportunity";

export type TodayTradeSectionKey = "idea" | "execution" | "review";

/**
 * One Today trade tab (Idea / Execution / Review) for the focused trade —
 * the existing Trade Workspace sections, rendered in-context. Extracted
 * unchanged from TodayWorkspace so the V2 workspace (Backtesting, Replay)
 * and the Today V3 Trade phase render the SAME trade surfaces until the V3
 * trade lifecycle replaces them.
 *
 * `allowCreate=false` (Today V3, readiness not confirmed) hides every way to
 * start a new trade from here — Add trade, the empty-state CTAs, and spotting
 * or taking an opportunity — while existing trades stay fully workable.
 */
export function TodayTradeTabs({
  section,
  dateKey,
  trades,
  focusedId,
  onFocus,
  accounts,
  strategies,
  activeSessions,
  sessionWindows,
  propFirmAccounts,
  executionsByTradeId,
  dailyAssetAnalyses,
  opportunities,
  linkableTrades,
  isArchived,
  allowCreate = true,
}: {
  section: TodayTradeSectionKey;
  dateKey: string;
  trades: TradeWorkspaceDTO[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  accounts: { id: string; name: string; kind: string }[];
  strategies: { id: string; name: string; version: number }[];
  activeSessions: string[];
  sessionWindows: SessionWindow[];
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executionsByTradeId: Record<string, ExecutionDTO[]>;
  dailyAssetAnalyses: DailyAssetAnalysisDTO[];
  opportunities: OpportunityListItemDTO[];
  linkableTrades: LinkableTrade[];
  isArchived: boolean;
  allowCreate?: boolean;
}) {
  const focusedTrade = trades.find((t) => t.id === focusedId) ?? null;
  const addTrade = allowCreate ? (
    <AddTradeDialog
      dateKey={dateKey}
      accounts={accounts}
      strategies={strategies}
      activeSessions={activeSessions}
      sessionWindows={sessionWindows}
    />
  ) : undefined;

  return (
    <div className="space-y-4">
      <TodayTradeBar
        trades={trades}
        focusedId={focusedId}
        onFocus={onFocus}
        todayKey={dateKey}
        accounts={accounts}
        strategies={strategies}
        activeSessions={activeSessions}
        sessionWindows={sessionWindows}
        allowCreate={allowCreate}
      />
      {focusedTrade ? (
        // key = tradeId: remount the whole section when the focused trade
        // changes, so every field's local state re-seeds from *this* trade's
        // data. Without it, React reuses the field instances across trades and
        // their useState carries the previous trade's values over.
        <div key={focusedTrade.id}>
          {section === "idea" ? (
            <TradeIdeaSection
              trade={focusedTrade}
              propFirmAccounts={propFirmAccounts}
              executions={executionsByTradeId[focusedTrade.id] ?? []}
              dailyMarketContext={(() => {
                const a = dailyAssetAnalyses.find((x) => x.assetSymbol === focusedTrade.assetSymbol);
                return a ? { finalBias: a.finalBias, evidenceSummary: a.evidenceSummary } : null;
              })()}
            />
          ) : section === "execution" ? (
            <TradeExecutionSection trade={focusedTrade} />
          ) : (
            <TradeReviewSection trade={focusedTrade} />
          )}
        </div>
      ) : !allowCreate ? (
        <EmptyState
          icon={Lock}
          title="Trading is locked"
          description="Confirm you're ready to trade in Prepare to start trade ideas. Your plan stays open in the meantime."
        />
      ) : section === "idea" && dailyAssetAnalyses.length > 0 ? (
        // Analysis is done and there's nothing to do until the market presents
        // a setup — a presentational state only (no workflow-state column).
        <EmptyState
          icon={Compass}
          title="Waiting for setup"
          description="Your asset analysis is complete. There's nothing to do until the market presents one of your setups — add a trade idea the moment it does."
          action={addTrade}
        />
      ) : (
        <EmptyState
          icon={CandlestickChart}
          title="No trades logged today yet"
          description="Add a trade to plan it, record how it played out, and review it — all in today's flow."
          action={addTrade}
        />
      )}

      {section === "idea" && (
        <OpportunitiesSection
          dateKey={dateKey}
          opportunities={opportunities}
          strategies={strategies}
          linkableTrades={linkableTrades}
          editable={!isArchived && allowCreate}
        />
      )}
    </div>
  );
}
