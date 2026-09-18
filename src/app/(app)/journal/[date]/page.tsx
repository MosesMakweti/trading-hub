import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ListChecks, Plus } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getOrCreateDailyNote, getJournalDayRecap } from "@/server/services/journal.service";
import { ImageAttachments } from "@/components/media/image-attachments";
import { getTradeFormOptions, listTradesForDay } from "@/server/services/trades.service";
import { listOpportunityDtosForDay } from "@/server/services/opportunity.service";
import { OpportunitiesSection } from "@/components/journal/opportunity/opportunities-section";
import { addDaysToKey, formatDateKeyLong, isValidDateKey, localDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { JournalDayRecap } from "@/components/journal/journal-day-recap";
import { TodayLiveCallout } from "@/components/journal/today-live-callout";
import { ReadOnlyDayBanner } from "@/components/journal/read-only-day-banner";
import { TradeCard } from "@/components/journal/trade-card";
import { DayOverviewPanel } from "@/components/journal/day/day-overview-panel";
import { DailyMarketPlanRecap } from "@/components/journal/day/daily-market-plan-recap";
import { AssetAnalysisRecap } from "@/components/journal/day/asset-analysis-recap";
import { DailyReflectionRecap } from "@/components/journal/day/daily-reflection-recap";
import { WORKFLOW_STEP_META, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { EmptyState } from "@/components/shared/empty-state";
import { FadeIn, StaggerList, StaggerItem } from "@/components/shared/motion";
import { executionSnapshot, resolveSelectedTags } from "@/server/services/selected-tags";
import { toTradeDiscrepancy } from "@/server/services/trade-discrepancy";
import { getDayCloseSummary } from "@/server/services/close-day.service";
import { listDailyAssetAnalyses, toDailyAssetAnalysisDTO } from "@/server/services/daily-asset-analysis.service";
import { getTradingDay, toTodaysPlanDTO } from "@/server/services/trading-day.service";
import {
  listBehaviourLabelsForTrades,
  type TradeBehaviourLabelSummaryDTO,
} from "@/server/services/behaviour-labels.service";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { TradeListItemDTO } from "@/types/trades";

/**
 * Journal Day view (Stage 9) — the historical record of a Trading Day: an
 * overview (Stage 8's getDayCloseSummary), the frozen Daily Outlook (Stage
 * 1) and Asset Analysis (Stage 2), the day's reflection + behaviour recap
 * (Stage 8/7), and every trade taken. Read-only by default — editing is the
 * exception (a carried-open trade's own execution/review fields; see
 * TradeWorkspace/isTradeWorkspaceEditable), never a live operating surface.
 * `isToday` still hands off to Today (TodayLiveCallout) — the live workflow
 * has never belonged here, and Stage 9 doesn't change that.
 */
export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const [note, trades, recap, opportunities, formOptions, day, assetAnalyses] = await Promise.all([
    getOrCreateDailyNote(user.id, dateKey),
    listTradesForDay(user.id, dateKey),
    getJournalDayRecap(user.id, dateKey),
    listOpportunityDtosForDay(user.id, dateKey),
    getTradeFormOptions(user.id),
    getTradingDay(user.id, dateKey),
    listDailyAssetAnalyses(user.id, dateKey),
  ]);

  const isToday = dateKey === localDateToKey(new Date());

  // The rest of this data is only needed for the historical (non-live) view —
  // Today already renders its own live version of all of it.
  const [daySummary, behaviourLabelsByTrade] = isToday
    ? [null, {} as Record<string, TradeBehaviourLabelSummaryDTO[]>]
    : await Promise.all([
        getDayCloseSummary(user.id, dateKey),
        listBehaviourLabelsForTrades(user.id, trades.map((t) => t.id)),
      ]);

  // Workflow recap (only for days that were opened in the Today workspace).
  let recapSteps: WorkflowStep[] = [];
  if (recap) {
    const done: WorkflowDoneState = {
      preSession: recap.prepDone,
      todaysPlan: recap.planDone,
      tradeIdea: trades.length > 0,
      execution: trades.some((t) => t.actualEntry != null),
      review: trades.some((t) => t.reviewedAt != null),
      daySummary: recap.analyzeDone,
    };
    const byKey = new Map(deriveWorkflowSteps(done).map((s) => [s.key, s.status]));
    recapSteps = WORKFLOW_STEP_META.map((m) => ({ ...m, status: byKey.get(m.key) ?? "upcoming" }));
  }

  const tradeDtos: TradeListItemDTO[] = trades.map((t) => {
    const setupSnapshot = t.setupValidationSnapshot as unknown as SetupValidationSnapshot | null;
    return {
      id: t.id,
      tradeNumber: t.tradeNumber ?? 0,
      assetSymbol: t.assetSymbol,
      executionMinutes: t.executionMinutes,
      direction: t.direction,
      higherTimeframeBias: t.higherTimeframeBias,
      biasConfidencePercent: t.biasConfidencePercent,
      expectedRR: t.expectedRR ? t.expectedRR.toNumber() : null,
      actualRR: t.actualRR ? t.actualRR.toNumber() : null,
      targets: t.plannedTargets.map((pt) => ({
        targetOrder: pt.targetOrder,
        label: pt.label,
        targetPrice: pt.targetPrice.toNumber(),
      })),
      accounts: t.allocations.map((a) => ({
        name: a.tradingAccount.name,
        riskInputType: a.riskInputType,
        riskValue: a.riskValue.toNumber(),
        // Stage C: null = not settled / not calculable yet — never a fake 0.
        closingPnlGross: a.closingPnlGross?.toNumber() ?? null,
        closingPnlNet: a.closingPnlNet?.toNumber() ?? null,
      })),
      entryModelName: t.selectedEntryModel,
      strategyName: t.strategyNameSnapshot,
      strategyId: t.strategy && !t.strategy.deletedAt ? t.strategy.id : null,
      confluenceLabels: resolveSelectedTags(
        t.selectedConfluences,
        executionSnapshot(t.strategyExecutionSnapshot).confluences,
        [],
      ),
      executionLabels: resolveSelectedTags(
        t.selectedExecution,
        executionSnapshot(t.strategyExecutionSnapshot).execution,
        [],
      ),
      tradeQualityPercent: t.tradeQualityPercent,
      setupScore: t.setupScore,
      setupRating: t.setupRating as TradeListItemDTO["setupRating"],
      setupValid: t.setupValid,
      discrepancy: toTradeDiscrepancy(t),
      psychology: t.psychology
        ? {
            rawScore: t.psychology.rawScore,
            percent: t.psychology.psychologyPercent,
            grade: t.psychology.grade,
          }
        : null,
      // Read verbatim from the frozen Stage 4 snapshot — never re-resolved
      // from live Strategy Lab config (Stage 9 §16).
      reviewLifecycleStatus: t.reviewLifecycleStatus,
      setupTypeName: setupSnapshot?.setupType.name ?? null,
      validationState: t.validationState,
      preTradeMoodTags: t.preTradeMoodTags,
      behaviourLabels: behaviourLabelsByTrade[t.id] ?? [],
    };
  });

  const prevKey = addDaysToKey(dateKey, -1);
  const nextKey = addDaysToKey(dateKey, 1);
  // Archived days are read-only until reopened (null recap = never opened = editable).
  const editable = recap?.status !== "ARCHIVED";

  // Opportunities: strategies drive validity; trades not already tied to an
  // opportunity can be linked as the "executed" outcome.
  const strategyOptions = formOptions.strategies.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
  }));
  const linkableTrades = trades
    .filter((t) => t.opportunityId == null)
    .map((t) => ({
      id: t.id,
      tradeNumber: t.tradeNumber,
      assetSymbol: t.assetSymbol,
      direction: t.direction,
    }));

  return (
    <FadeIn className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous day"
            nativeButton={false}
            render={<Link href={`/journal/${prevKey}`} />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {formatDateKeyLong(dateKey)}
              </h1>
              {recap && (
                <Badge variant={recap.status === "ARCHIVED" ? "secondary" : "success"}>
                  {recap.status === "ARCHIVED" ? "Archived" : "Active"}
                </Badge>
              )}
            </div>
            {isToday && <p className="text-xs text-primary">Today</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next day"
            nativeButton={false}
            render={<Link href={`/journal/${nextKey}`} />}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/journal" />}>
          Back to calendar
        </Button>
      </div>

      {!editable && <ReadOnlyDayBanner dateKey={dateKey} />}

      {/* Today's live routine/plan/workflow live in the Today workspace, not
          here — show a signpost instead of a frozen recap of the live day.
          Past days get the full historical record below. */}
      {isToday ? (
        <TodayLiveCallout recap={recap} tradeCount={trades.length} />
      ) : (
        <>
          {recap && <JournalDayRecap recap={recap} steps={recapSteps} />}
          {daySummary && <DayOverviewPanel summary={daySummary} />}
          {day && (
            <DailyMarketPlanRecap
              plan={toTodaysPlanDTO(day)}
              assetSymbols={assetAnalyses.map((a) => a.assetSymbol)}
            />
          )}
          {day && <AssetAnalysisRecap analyses={assetAnalyses.map(toDailyAssetAnalysisDTO)} />}
          {daySummary && <DailyReflectionRecap summary={daySummary} />}
        </>
      )}

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Daily Notes</h2>
        <DailyNoteEditor
          dateKey={dateKey}
          initialContent={note?.content ?? null}
          editable={editable}
        />
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">Day images</h3>
          <ImageAttachments ownerType="DAILY_NOTE" ownerId={note.id} max={12} disabled={!editable} />
        </div>
      </section>

      <OpportunitiesSection
        dateKey={dateKey}
        opportunities={opportunities}
        strategies={strategyOptions}
        linkableTrades={linkableTrades}
        editable={editable}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trades</h2>
          {editable && (
            <Button
              size="sm"
              className="gap-1.5"
              nativeButton={false}
              render={<Link href={`/journal/${dateKey}/trades/new`} />}
            >
              <Plus className="size-3.5" />
              Add Trade
            </Button>
          )}
        </div>
        {tradeDtos.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No trades logged yet"
            description="Log your first trade for this day — accounts, risk/PnL, checklists, and RR are all tracked per trade."
          />
        ) : (
          <StaggerList className="space-y-3">
            {tradeDtos.map((trade) => (
              <StaggerItem key={trade.id}>
                <TradeCard dateKey={dateKey} trade={trade} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </FadeIn>
  );
}
