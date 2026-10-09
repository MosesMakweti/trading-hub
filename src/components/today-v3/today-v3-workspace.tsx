"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlagOff, Loader2 } from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reopenDay } from "@/actions/today.actions";
import { acknowledgePreparationNoticeAction } from "@/actions/preparation.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import { PreSessionRoutineSection } from "@/components/today/pre-session-routine-section";
import { allMandatoryComplete, mandatoryProgress } from "@/domain/today/routine-snapshot";
import { computeDayUsage, evaluateLimitState } from "@/domain/today/limit-state";
import {
  buildStatusWarnings,
  defaultPhase,
  deriveDayPhase,
  derivePhaseRail,
  loggedBeforeReadiness,
  type PhaseKey,
} from "@/domain/today/day-phase";
import { DayStatusStrip } from "@/components/today-v3/day-status-strip";
import { CarryForwardStrip } from "@/components/today-v3/carry-forward-strip";
import { PhaseRail } from "@/components/today-v3/phase-rail";
import { PlanPhase } from "@/components/today-v3/plan-phase";
import { TradePhase } from "@/components/today-v3/trade-phase";
import { ClosePhase } from "@/components/today-v3/close-phase";
import { PreparationSummary } from "@/components/today-v3/preparation-summary";
import { PreparationBreakNotice } from "@/components/today-v3/preparation-notice";
import { readinessFeedback } from "@/lib/preparation-format";
import { QuickIdeaSheet, type QuickIdeaRequest } from "@/components/today-v3/trade/quick-idea-sheet";
import type { TradeListRow } from "@/components/today-v3/trade/trade-list";
import { deriveLifecycleWithReview, type TradeStageKey } from "@/domain/trades/trade-lifecycle";
import { ideaDefaults } from "@/domain/today/idea-inheritance";
import type { DailyAssetAnalysisDTO } from "@/types/today";
import type { OpportunityListItemDTO } from "@/types/opportunity";
import type { TradingWorkspaceData } from "@/server/services/trading-workspace.service";

/**
 * Today V3 — the LIVE Today orchestration shell:
 * Day header → Status strip → Carry-forward → Phase rail → Prepare · Plan ·
 * Trade · Close. Mounted only by app/(app)/today/page.tsx; the Backtesting
 * Session and Replay keep mounting the V2 TodayWorkspace, and both share the
 * same leaf components and domain logic (Decision 11).
 *
 * Decision 1: Plan is always open; readiness (routine) gates TRADING only.
 */
export function TodayV3Workspace(data: TradingWorkspaceData) {
  const {
    day,
    routine,
    todaysPlan,
    trades,
    dailyAssetAnalyses,
    sessionWindows,
    todaysRules,
    carryForward,
    reviewCommitments,
    commitmentDailyStates,
    commitmentAdherence,
    carriedTrades,
    lifecycleFacts,
    closeDay,
  } = data;
  const dayRef = useDayRef(day.dateKey);
  const router = useRouter();
  const archived = day.status === "ARCHIVED";

  // Preparation Score (Phase 3) — server read model only; no schedule → nothing renders.
  const preparation = data.preparation?.configured ? data.preparation : null;
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const [dismissing, startDismiss] = useTransition();
  const notice = preparation?.notice && preparation.notice.recordId !== dismissedNotice ? preparation.notice : null;
  function dismissNotice(recordId: string) {
    setDismissedNotice(recordId); // optimistic; the server records the acknowledgment
    startDismiss(async () => {
      const r = await acknowledgePreparationNoticeAction({ recordId });
      if (!r.success) {
        setDismissedNotice(null);
        toast.error(r.error);
      }
    });
  }
  // Quiet score feedback, ONLY for a readiness confirmation made here: the
  // flag is armed by onReadyChange(true) and consumed by the first refreshed
  // read model after it. Refreshes (incl. the cutoff refresh that finalizes
  // a day as INCOMPLETE/MISSED) and repeated renders never toast.
  const awaitingReadinessFeedback = useRef(false);
  useEffect(() => {
    if (!awaitingReadinessFeedback.current) return;
    awaitingReadinessFeedback.current = false;
    const feedback = readinessFeedback(true, preparation?.today, preparation?.streak.restartedToday ?? false);
    if (feedback) toast.success(feedback.title, { description: feedback.description });
  }, [preparation]);

  // Same readiness rule as V2: confirmation AND every mandatory item still
  // complete; `optimisticReady` unlocks the moment the routine confirms.
  const [optimisticReady, setOptimisticReady] = useState(false);
  const serverReady = routine.readyAt != null && allMandatoryComplete(routine.snapshot);
  const ready = optimisticReady || serverReady;
  const initialRemaining = (() => {
    const m = mandatoryProgress(routine.snapshot);
    return m.total - m.completed;
  })();
  const [mandatoryRemaining, setMandatoryRemaining] = useState(initialRemaining);
  const onMandatoryRemainingChange = useCallback((n: number) => setMandatoryRemaining(n), []);

  const facts = { archived, ready, planSet: todaysPlan.planComplete, tradeCount: trades.length };
  const [active, setActive] = useState<PhaseKey>(() => defaultPhase(facts));

  const usage = computeDayUsage(
    trades.map((t) => ({
      hasActualEntry: t.actualEntry != null,
      cancelled: t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED",
      performanceRiskPercent: t.performanceRisk?.riskPercent ?? null,
    })),
  );
  const limits = { riskLimitPercent: todaysPlan.riskBudgetPercent, maxTrades: todaysPlan.maxTradesPerDay };
  const limitState = evaluateLimitState(usage, limits);
  const loggedBeforeReadyCount = trades.filter((t) => loggedBeforeReadiness(t.createdAt, routine.readyAt)).length;
  // Trade list rows — one derivation for every trade's display state.
  const tradingReady = ready && !archived;
  const toRow = (t: (typeof trades)[number], carried: boolean): TradeListRow => {
    const f = lifecycleFacts[t.id];
    const closedMoment = f?.closedMoment ?? t.closedAt;
    const { lifecycle } = deriveLifecycleWithReview(
      {
        cancelled: t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED",
        hasConfirmedPlan: f?.hasConfirmedPlan ?? t.plannedEntry != null,
        planLocked: f?.planLocked ?? false,
        hasActualEntry: t.actualEntry != null,
        exitedPercent: f?.exitedPercent ?? null,
        hasLegacyResult: t.actualEntry == null && t.actualRR != null,
        settled: t.performanceRisk?.settled === true,
        tradingReady,
      },
      {
        closedMoment: closedMoment ? new Date(closedMoment) : null,
        reviewedAt: t.reviewedAt ? new Date(t.reviewedAt) : null,
        answers: {
          tradeIntent: t.tradeIntent,
          adherenceAnswers: t.adherenceAnswers,
          wouldTakeAgain: t.wouldTakeAgain,
        },
      },
    );
    return { trade: t, carried, lifecycle };
  };
  const rows: TradeListRow[] = [...carriedTrades.map((t) => toRow(t, true)), ...trades.map((t) => toRow(t, false))];
  // Phase 3 — "review needed" = the derived FINAL review is outstanding
  // (an interim or text-only review doesn't clear it).
  const reviewPendingCount = rows.filter((r) => !r.carried && r.lifecycle.state === "REVIEW_NEEDED").length;

  const analysisFor = (symbol: string) => dailyAssetAnalyses.find((a) => a.assetSymbol === symbol.toUpperCase()) ?? null;
  const planContext = { lookingFor: todaysPlan.lookingFor, stayOutConditions: todaysPlan.stayOutConditions };
  const projectedRiskPercent = todaysRules?.performance.defaultRiskPercent ?? null;

  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [requestedStage, setRequestedStage] = useState<{ tradeId: string; stage: TradeStageKey } | null>(null);
  const [quickIdea, setQuickIdea] = useState<QuickIdeaRequest | null>(null);
  const [showSetups, setShowSetups] = useState(false);
  // Close → "Review now" / "Open": jump straight to that trade's stage.
  function openTrade(tradeId: string, stage: TradeStageKey) {
    setActive("trade");
    setSelectedTradeId(tradeId);
    setRequestedStage({ tradeId, stage });
  }
  const nowMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  function openQuickIdea(analysis: DailyAssetAnalysisDTO | null) {
    const d = ideaDefaults(
      analysis
        ? { assetSymbol: analysis.assetSymbol, activeStrategyId: analysis.activeStrategyId, finalBias: analysis.finalBias, htfBias: analysis.htfBias }
        : null,
      { activeSessions: todaysPlan.activeSessions, sessionWindows, nowMinutes: nowMinutes() },
    );
    setQuickIdea({ defaults: d, assetLocked: analysis != null, key: Date.now() });
  }
  function takeOpportunity(o: OpportunityListItemDTO) {
    setQuickIdea({
      key: Date.now(),
      assetLocked: true,
      opportunityId: o.id,
      defaults: {
        assetSymbol: o.assetSymbol,
        strategyId: o.strategyId,
        // The direction was decided when the setup was spotted.
        direction: o.direction,
        directionFromFinalBias: false,
        session: ideaDefaults(null, { activeSessions: todaysPlan.activeSessions, sessionWindows, nowMinutes: nowMinutes() }).session,
        selectedConfluences: o.confluenceLabels.map((c) => c.name),
      },
    });
  }

  const warnings = buildStatusWarnings({
    archived,
    ready,
    mandatoryRemaining,
    risk: limitState.risk,
    trades: limitState.trades,
    reviewPendingCount,
    // Only meaningful once readiness exists; before that ROUTINE_INCOMPLETE says it.
    loggedBeforeReadyCount: serverReady ? loggedBeforeReadyCount : 0,
    carriedOpenCount: carriedTrades.length,
  });
  const phase = deriveDayPhase(facts);
  const rail = derivePhaseRail({ ...facts, tradesNeedingAttention: reviewPendingCount + carriedTrades.length });

  const [reopening, startReopen] = useTransition();
  function reopen() {
    startReopen(async () => {
      const r = await reopenDay(dayRef);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success("Day reopened.");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="font-mono text-xs text-muted-foreground">{formatDateKeyLong(day.dateKey)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={archived ? "secondary" : "success"}>{archived ? "Archived" : "Active"}</Badge>
          {archived && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={reopen} disabled={reopening}>
              {reopening ? <Loader2 className="size-3.5 animate-spin" /> : <FlagOff className="size-3.5" />}
              Reopen day
            </Button>
          )}
        </div>
      </header>

      <DayStatusStrip
        phase={phase}
        usage={usage}
        limits={limits}
        limitState={limitState}
        warnings={warnings}
        sessionWindows={sessionWindows}
        activeSessions={todaysPlan.activeSessions}
      />

      <CarryForwardStrip
        lastSession={carryForward}
        commitments={reviewCommitments}
        todayKey={day.dateKey}
        commitmentDailyStates={commitmentDailyStates}
        commitmentAdherence={commitmentAdherence}
      />

      {notice && preparation && (
        <PreparationBreakNotice
          notice={notice}
          todayKey={preparation.todayKey}
          onDismiss={() => dismissNotice(notice.recordId)}
          dismissing={dismissing}
        />
      )}

      <PhaseRail
        items={rail}
        active={active}
        onSelect={setActive}
        counts={{ trade: trades.length + carriedTrades.length }}
        lockReason="Trading unlocks once you confirm readiness in Prepare"
      />

      {/* Every phase stays mounted-on-demand; Prepare keeps its own save chain. */}
      <div>
        {active === "prepare" && (
          <PreSessionRoutineSection
            dateKey={day.dateKey}
            routine={routine}
            variant="v3"
            summary={preparation ? <PreparationSummary view={preparation} onCutoffPassed={() => router.refresh()} /> : undefined}
            onMandatoryRemainingChange={onMandatoryRemainingChange}
            onReadyChange={(next) => {
              setOptimisticReady(next);
              awaitingReadinessFeedback.current = next && preparation != null;
              if (next) setActive(todaysPlan.planComplete ? "trade" : "plan");
            }}
          />
        )}
        {active === "plan" && (
          <PlanPhase
            dateKey={day.dateKey}
            plan={todaysPlan}
            rules={todaysRules}
            analyses={dailyAssetAnalyses}
            strategies={data.tradeFormStrategies}
            tradeFormAccounts={data.tradeFormAccounts}
            sessionWindows={sessionWindows}
            ready={ready}
            readOnly={archived}
            onStartIdea={(analysis) => {
              setActive("trade");
              openQuickIdea(analysis);
            }}
            onContinue={setActive}
          />
        )}
        {active === "trade" && (
          <TradePhase
            ready={ready}
            archived={archived}
            dateKey={day.dateKey}
            rows={rows}
            lifecycleFacts={lifecycleFacts}
            routineReadyAt={routine.readyAt}
            selectedId={selectedTradeId}
            onSelect={setSelectedTradeId}
            requestedStage={requestedStage}
            onNewIdea={() => openQuickIdea(null)}
            onTakeOpportunity={takeOpportunity}
            onGoToPrepare={() => setActive("prepare")}
            strategies={data.tradeFormStrategies}
            analysisFor={analysisFor}
            plan={planContext}
            usage={usage}
            limits={limits}
            propFirmAccounts={data.propFirmAccounts}
            executionsByTradeId={data.executionsByTradeId}
            opportunities={data.opportunities}
            linkableTrades={data.linkableTrades}
            showSetups={showSetups}
            onShowSetupsChange={setShowSetups}
            analyses={dailyAssetAnalyses}
          />
        )}
        {active === "close" && closeDay && (
          <ClosePhase
            data={closeDay}
            onOpenTrade={openTrade}
            onOpenSetups={() => {
              setActive("trade");
              setShowSetups(true);
            }}
            onReopen={reopen}
            reopening={reopening}
          />
        )}
      </div>

      <QuickIdeaSheet
        request={quickIdea}
        onClose={() => setQuickIdea(null)}
        onCreated={(tradeId, next) => {
          setQuickIdea(null);
          setActive("trade");
          setSelectedTradeId(tradeId);
          setRequestedStage({ tradeId, stage: next === "plan" ? "plan" : "idea" });
          router.refresh();
        }}
        dateKey={day.dateKey}
        strategies={data.tradeFormStrategies}
        assetOptions={dailyAssetAnalyses.map((a) => a.assetSymbol)}
        analysisFor={analysisFor}
        plan={planContext}
        usage={usage}
        limits={limits}
        projectedRiskPercent={projectedRiskPercent}
      />
    </div>
  );
}
