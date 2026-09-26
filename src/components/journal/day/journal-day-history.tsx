import type { ReactNode } from "react";
import { ListChecks } from "lucide-react";

import { JournalDayRecap } from "@/components/journal/journal-day-recap";
import { DayOverviewPanel } from "@/components/journal/day/day-overview-panel";
import { DailyMarketPlanRecap } from "@/components/journal/day/daily-market-plan-recap";
import { AssetAnalysisRecap } from "@/components/journal/day/asset-analysis-recap";
import { DailyReflectionRecap } from "@/components/journal/day/daily-reflection-recap";
import { OpportunitiesSection } from "@/components/journal/opportunity/opportunities-section";
import { TradeCard } from "@/components/journal/trade-card";
import { WORKFLOW_STEP_META, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerItem, StaggerList } from "@/components/shared/motion";
import type { JournalDayData } from "@/server/services/journal-day-view.service";

/**
 * The historical record of one Journal day — shared by the live Journal and
 * the Backtesting Journal (Stage 5), fed by `loadJournalDay`. Two halves so
 * the live page can keep its Daily Notes between them exactly as before.
 */
export function JournalDayRecord({ data, showPnl = true }: { data: JournalDayData; showPnl?: boolean }) {
  const byKey = new Map(data.recapStatuses.map((s) => [s.key, s.status]));
  const steps: WorkflowStep[] = WORKFLOW_STEP_META.map((m) => ({ ...m, status: byKey.get(m.key) ?? "upcoming" }));
  return (
    <>
      {data.recap && <JournalDayRecap recap={data.recap} steps={steps} />}
      {data.daySummary && <DayOverviewPanel summary={data.daySummary} showPnl={showPnl} />}
      {data.plan && <DailyMarketPlanRecap plan={data.plan} assetSymbols={data.assetAnalyses.map((a) => a.assetSymbol)} />}
      {data.plan && <AssetAnalysisRecap analyses={data.assetAnalyses} />}
      {data.daySummary && <DailyReflectionRecap summary={data.daySummary} />}
    </>
  );
}

export function JournalDayActivity({
  data,
  dateKey,
  editable,
  tradesAction,
  emptyTradesDescription,
}: {
  data: JournalDayData;
  dateKey: string;
  editable: boolean;
  /** e.g. the live Journal's "Add Trade" button. */
  tradesAction?: ReactNode;
  emptyTradesDescription: string;
}) {
  return (
    <>
      <OpportunitiesSection
        dateKey={dateKey}
        opportunities={data.opportunities}
        strategies={data.strategyOptions}
        linkableTrades={data.linkableTrades}
        editable={editable}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trades</h2>
          {tradesAction}
        </div>
        {data.trades.length === 0 ? (
          <EmptyState icon={ListChecks} title="No trades logged yet" description={emptyTradesDescription} />
        ) : (
          <StaggerList className="space-y-3">
            {data.trades.map((trade) => (
              <StaggerItem key={trade.id}>
                <TradeCard dateKey={dateKey} trade={trade} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </>
  );
}
