"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  CandlestickChart,
  ClipboardCheck,
  Compass,
  FlagOff,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  History,
  NotebookText,
  Sun,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateKeyLong } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reopenDay } from "@/actions/today.actions";
import { CloseDayDialog } from "@/components/today/close-day-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import {
  PreSessionRoutineSection,
  type DayRoutineDTO,
} from "@/components/today/pre-session-routine-section";
import { allMandatoryComplete } from "@/domain/today/routine-snapshot";
import { DailyMarketPlanSection } from "@/components/today/daily-market-plan-section";
import { DailyAnalyticsSection } from "@/components/today/daily-analytics-section";
import { TodayTradeBar } from "@/components/today/today-trade-bar";
import { TodayFocusFromReview } from "@/components/today/today-focus-from-review";
import { AddTradeDialog } from "@/components/today/add-trade-dialog";
import { OpportunitiesSection } from "@/components/journal/opportunity/opportunities-section";
import type { LinkableTrade } from "@/components/journal/opportunity/opportunity-card";
import type { OpportunityListItemDTO } from "@/types/opportunity";
import { TradeIdeaSection } from "@/components/journal/workspace/trade-idea-section";
import { TradeExecutionSection } from "@/components/journal/workspace/trade-execution-section";
import { TradeReviewSection } from "@/components/journal/workspace/trade-review-section";
import {
  WorkflowProgress,
  WORKFLOW_STEP_META,
  type WorkflowStep,
} from "@/components/dashboard/workflow-progress";
import type { WorkflowStepKey, WorkflowStepStatus } from "@/domain/today/workflow";
import type { SessionWindow } from "@/domain/schedule/session-countdown";
import type {
  DailyAnalyticsDTO,
  DailyAssetAnalysisDTO,
  TodaysPlanDTO,
  TradingDayDTO,
} from "@/types/today";
import type { TradeWorkspaceDTO } from "@/types/trades";
import type { AccountAllocationSelectorDTO, ExecutionDTO } from "@/types/prop-firms";
import type { AdherenceResultDTO, AdherenceTrend, EdgeReviewCommitmentDailyStatus, TodayCommitmentsDTO } from "@/types/edge-improvements";
import { useDayRef, useWorkspace } from "@/components/workspace/workspace-context";
import { CarryForwardCard } from "@/components/backtesting/carry-forward-card";
import type { CarryForwardDTO } from "@/server/services/trading-workspace.service";

// The Today workflow section tabs — Pre-Session -> Today's Plan -> Trade Idea
// -> Execution -> Review -> Day Summary (Today V2 Final Phase §5). The
// Pre-Session Routine is first; the rest stay locked until the "I am ready
// to trade" gate is confirmed. `step` maps each tab to the same canonical
// WorkflowStepKey the stepper above already derives, so a tab's own status
// dot (§6 progressive disclosure) is never a second, independently-computed
// signal.
const ROUTINE_TAB = "pre-session-routine";
const SECTIONS: { value: string; label: string; icon: LucideIcon; step: WorkflowStepKey }[] = [
  { value: ROUTINE_TAB, label: "Pre-Session", icon: ListChecks, step: "preSession" },
  { value: "daily-market-plan", label: "Today's Plan", icon: NotebookText, step: "todaysPlan" },
  { value: "trade-idea", label: "Trade Idea", icon: Lightbulb, step: "tradeIdea" },
  { value: "trade-execution", label: "Execution", icon: Zap, step: "execution" },
  { value: "trade-review", label: "Review", icon: BookOpenCheck, step: "review" },
  { value: "daily-analytics", label: "Day Summary", icon: ClipboardCheck, step: "daySummary" },
];

export function TodayWorkspace({
  day,
  stepStatuses,
  routine,
  todaysPlan,
  trades,
  dailyAnalytics,
  propFirmAccounts,
  executionsByTradeId,
  tradeFormAccounts,
  tradeFormStrategies,
  opportunities,
  dailyAssetAnalyses,
  linkableTrades,
  reviewCommitments,
  commitmentDailyStates,
  commitmentAdherence,
  sessionWindows,
  carryForward = null,
}: {
  day: TradingDayDTO;
  // Only serializable data crosses the server→client boundary; the icon-bearing
  // steps are rebuilt here from WORKFLOW_STEP_META (imported client-side).
  stepStatuses: { key: WorkflowStepKey; status: WorkflowStepStatus }[];
  routine: DayRoutineDTO;
  todaysPlan: TodaysPlanDTO;
  trades: TradeWorkspaceDTO[];
  dailyAnalytics: DailyAnalyticsDTO;
  propFirmAccounts: AccountAllocationSelectorDTO[];
  executionsByTradeId: Record<string, ExecutionDTO[]>;
  // For the in-flow "Add trade" dialog (so logging a trade never leaves Today).
  tradeFormAccounts: { id: string; name: string; kind: string }[];
  tradeFormStrategies: { id: string; name: string; version: number }[];
  // Opportunities (spotted setups / Discrepancy Gap) — surfaced in the Trade
  // Idea tab so missed setups get logged without leaving Today.
  opportunities: OpportunityListItemDTO[];
  dailyAssetAnalyses: DailyAssetAnalysisDTO[];
  linkableTrades: LinkableTrade[];
  reviewCommitments: TodayCommitmentsDTO;
  commitmentDailyStates: Record<string, EdgeReviewCommitmentDailyStatus>;
  commitmentAdherence: Record<string, { current: AdherenceResultDTO; trend: AdherenceTrend }>;
  // Today V2 (T3) — day-level session inheritance for the generic "Add
  // trade" entry points (TradingDay.activeSessions itself lives on
  // `todaysPlan.activeSessions`, already in scope below).
  sessionWindows: SessionWindow[];
  /** Backtest only — the previous simulated day's carry-forward (Refinement
   *  inside the run). Live Today's refinement is Edge Review commitments. */
  carryForward?: CarryForwardDTO | null;
}) {
  const dayRef = useDayRef(day.dateKey);
  // The only environment branch in the workflow shell: a backtest renders
  // under the run's own page header, and swaps live-only Edge Review
  // commitments for the run's own carried-forward refinement.
  const { isBacktest } = useWorkspace();
  const router = useRouter();
  // The Pre-Session Routine gates the rest of the day: the trader must have confirmed
  // readiness AND every mandatory routine item must still be complete. (Confirmation
  // alone isn't enough — a required item added mid-day re-locks Today's Plan.)
  // `optimisticReady` unlocks the moment the routine's Continue button fires, so the
  // workspace can move to the Plan tab without waiting for the server round-trip.
  const [optimisticReady, setOptimisticReady] = useState(false);
  const routineReady =
    optimisticReady || (routine.readyAt != null && allMandatoryComplete(routine.snapshot));

  // Controlled tab so each step's "Continue" / "Complete" CTA carries the trader
  // forward instead of leaving them on the section they just finished.
  const [activeTab, setActiveTab] = useState(ROUTINE_TAB);
  function advanceTo(tab: string) {
    setActiveTab(tab);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [focusedId, setFocusedId] = useState<string | null>(trades[0]?.id ?? null);
  // The in-flow "Add trade" dialog refreshes the day in place, so `focusedId`
  // can be stale (null, or pointing at a deleted trade). Resolve it every
  // render — falling back to the newest trade — so a freshly-logged trade
  // shows immediately instead of the empty state.
  const effectiveFocusedId =
    focusedId && trades.some((t) => t.id === focusedId)
      ? focusedId
      : (trades[trades.length - 1]?.id ?? null);
  const focusedTrade = trades.find((t) => t.id === effectiveFocusedId) ?? null;

  const isArchived = day.status === "ARCHIVED";
  const [archiving, startArchive] = useTransition();
  function reopen() {
    startArchive(async () => {
      const result = await reopenDay(dayRef);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Day reopened.");
      router.refresh();
    });
  }

  // The three trade tabs share one focused trade and render the *existing* Trade
  // Workspace sections for it — create/continue today's trades in-context.
  function tradeTab(section: "idea" | "execution" | "review") {
    return (
      <div className="space-y-4">
        <TodayTradeBar
          trades={trades}
          focusedId={effectiveFocusedId}
          onFocus={setFocusedId}
          todayKey={day.dateKey}
          accounts={tradeFormAccounts}
          strategies={tradeFormStrategies}
          activeSessions={todaysPlan.activeSessions}
          sessionWindows={sessionWindows}
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
                dailyMarketContext={
                  (() => {
                    const a = dailyAssetAnalyses.find((x) => x.assetSymbol === focusedTrade.assetSymbol);
                    return a ? { finalBias: a.finalBias, evidenceSummary: a.evidenceSummary } : null;
                  })()
                }
              />
            ) : section === "execution" ? (
              <TradeExecutionSection trade={focusedTrade} />
            ) : (
              <TradeReviewSection trade={focusedTrade} />
            )}
          </div>
        ) : section === "idea" && dailyAssetAnalyses.length > 0 ? (
          // Analysis is done and there's nothing to do until the market presents
          // a setup — a presentational state only (no workflow-state column).
          <EmptyState
            icon={Compass}
            title="Waiting for setup"
            description="Your asset analysis is complete. There's nothing to do until the market presents one of your setups — add a trade idea the moment it does."
            action={
              <AddTradeDialog
                dateKey={day.dateKey}
                accounts={tradeFormAccounts}
                strategies={tradeFormStrategies}
                activeSessions={todaysPlan.activeSessions}
                sessionWindows={sessionWindows}
              />
            }
          />
        ) : (
          <EmptyState
            icon={CandlestickChart}
            title="No trades logged today yet"
            description="Add a trade to plan it, record how it played out, and review it — all in today's flow."
            action={
              <AddTradeDialog
                dateKey={day.dateKey}
                accounts={tradeFormAccounts}
                strategies={tradeFormStrategies}
                activeSessions={todaysPlan.activeSessions}
                sessionWindows={sessionWindows}
              />
            }
          />
        )}

        {section === "idea" && (
          <OpportunitiesSection
            dateKey={day.dateKey}
            opportunities={opportunities}
            strategies={tradeFormStrategies}
            linkableTrades={linkableTrades}
            editable={!isArchived}
          />
        )}
      </div>
    );
  }
  const statusByKey = new Map(stepStatuses.map((s) => [s.key, s.status]));
  const steps: WorkflowStep[] = WORKFLOW_STEP_META.map((m) => ({
    ...m,
    status: statusByKey.get(m.key) ?? "upcoming",
  }));

  // Today V2 Final Phase §6 — progressive disclosure: every tab stays
  // reachable (guidance, not bureaucracy — a trader may legitimately jump
  // ahead), but its own status dot shows at a glance what's done, what's
  // current, and what's still waiting on something earlier.
  const tabStatusDot: Record<WorkflowStepStatus, string> = {
    done: "bg-success",
    current: "bg-primary",
    upcoming: "bg-border",
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-brand-gradient inline-flex size-8 items-center justify-center rounded-lg text-white shadow-glow">
            {isBacktest ? <History className="size-4" /> : <Sun className="size-4" />}
          </span>
          {isBacktest ? (
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Simulated session</h2>
              <p className="text-sm text-muted-foreground">{formatDateKeyLong(day.dateKey)}</p>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today</h1>
              <p className="mt-1 text-sm text-muted-foreground">{formatDateKeyLong(day.dateKey)}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isArchived ? "secondary" : "success"}>
            {isArchived ? "Archived" : "Active"}
          </Badge>
          {isArchived ? (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={reopen} disabled={archiving}>
              {archiving ? <Loader2 className="size-3.5 animate-spin" /> : <FlagOff className="size-3.5" />}
              Reopen day
            </Button>
          ) : (
            <CloseDayDialog dateKey={day.dateKey} />
          )}
        </div>
      </div>

      {isBacktest ? (
        <CarryForwardCard carryForward={carryForward} />
      ) : (
        <TodayFocusFromReview
          commitments={reviewCommitments}
          todayKey={day.dateKey}
          initialDailyStates={commitmentDailyStates}
          adherence={commitmentAdherence}
        />
      )}

      <WorkflowProgress steps={steps} title="Workflow" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            {SECTIONS.map((s) => {
              const locked = !routineReady && s.value !== ROUTINE_TAB;
              const status = statusByKey.get(s.step) ?? "upcoming";
              return (
                <TabsTrigger
                  key={s.value}
                  value={s.value}
                  disabled={locked}
                  className="gap-1.5"
                  title={locked ? "Complete your Pre-Session Routine to unlock" : undefined}
                >
                  {locked ? <Lock className="size-3.5" /> : <s.icon className="size-3.5" />}
                  {s.label}
                  {!locked && (
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", tabStatusDot[status])}
                      aria-label={`${s.label}: ${status}`}
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {SECTIONS.map((s) => (
          <TabsContent key={s.value} value={s.value} className="mt-4">
            {s.value === ROUTINE_TAB ? (
              <PreSessionRoutineSection
                dateKey={day.dateKey}
                routine={routine}
                onReadyChange={(ready) => {
                  setOptimisticReady(ready);
                  if (ready) advanceTo("daily-market-plan");
                  else setActiveTab(ROUTINE_TAB);
                }}
              />
            ) : s.value === "daily-market-plan" ? (
              <DailyMarketPlanSection
                dateKey={day.dateKey}
                plan={todaysPlan}
                analyses={dailyAssetAnalyses}
                onComplete={() => advanceTo("trade-idea")}
                strategies={tradeFormStrategies}
                tradeFormAccounts={tradeFormAccounts}
                activeSessions={todaysPlan.activeSessions}
                sessionWindows={sessionWindows}
              />
            ) : s.value === "trade-idea" ? (
              tradeTab("idea")
            ) : s.value === "trade-execution" ? (
              tradeTab("execution")
            ) : s.value === "trade-review" ? (
              tradeTab("review")
            ) : (
              <DailyAnalyticsSection dateKey={day.dateKey} analytics={dailyAnalytics} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
