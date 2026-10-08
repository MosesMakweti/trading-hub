import { dateKeyToUtcDate } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import {
  archivePastActiveDays,
  getOrCreateTradingDay,
  toTradingDayDTO,
  toTodaysPlanDTO,
} from "@/server/services/trading-day.service";
import { getTradeFormOptions, listTradesForDay } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { getOrCreateDayRoutine } from "@/server/services/today-routine.service";
import { getDailyAnalytics } from "@/server/services/analytics.service";
import { listOpportunityDtosForDay } from "@/server/services/opportunity.service";
import { listDailyAssetAnalyses, toDailyAssetAnalysisDTO } from "@/server/services/daily-asset-analysis.service";
import { listActivePropFirmAccountsForSelector } from "@/server/services/prop-firms.service";
import { listExecutionsForTrades } from "@/server/services/trade-executions.service";
import { toAccountAllocationSelectorDTO, toExecutionDTO } from "@/server/services/prop-firms.mapper";
import {
  getActiveCommitmentsForToday,
  getAdherenceSummaries,
  getCommitmentDailyStates,
} from "@/server/services/edge-review-commitment.service";
import { listStrategySessionWindows } from "@/server/services/strategy-sot.service";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { LIVE_SCOPE, runLive } from "@/server/workspace/scope";
import { assertDatabaseSeesScope } from "@/server/workspace/scope-tripwire";
import { getTodaysRules } from "@/server/services/today-rules.service";
import { getTradeLifecycleFacts, listCarriedOpenTrades } from "@/server/services/today-trade.service";
import { loadPreparationState } from "@/server/services/preparation.service";
import { toPreparationDTO } from "@/server/services/preparation.mapper";
import { getCloseDayV3, getLastSessionCarryForward, type CarryForwardDTO } from "@/server/services/close-day-v3.service";
import type { DailyAnalyticsDTO, TodaysRulesDTO } from "@/types/today";
import type { PreparationDTO } from "@/types/preparation";
import type { AdherenceResultDTO, AdherenceTrend, EdgeReviewCommitmentDailyStatus, TodayCommitmentsDTO } from "@/types/edge-improvements";
import type { ExecutionDTO } from "@/types/prop-firms";

/**
 * The ONE loader behind the Today workflow (Backtesting Stage 3), used by both
 * `/today` (LIVE, effective date = the real trading day) and the Backtesting
 * Session (BACKTEST, effective date = the selected simulation date). Every
 * query runs inside the environment's workspace scope, so the shared services
 * return only live rows for Today and only the run's rows for a Session.
 *
 * Live-only concerns are loaded for LIVE only and come back empty in a
 * backtest: auto-archiving past days (a simulated day is closed only by the
 * trader), Prop Firm accounts/executions, and Edge Review commitments. In a
 * backtest the previous simulated day's carry-forward reflection is loaded
 * instead (Refinement inside the run) — strictly an EARLIER date, so nothing
 * from the future of the run reaches the session.
 */
export type WorkspaceLoadTarget = { environment: "LIVE" } | { environment: "BACKTEST"; runId: string };

export type { CarryForwardDTO };

const EMPTY_COMMITMENTS: TodayCommitmentsDTO = { weekly: [], monthly: [] };

async function load(userId: string, dateKey: string, isLive: boolean) {
  if (isLive) {
    // Auto-archive on date rollover: finalize any still-active past day before
    // opening today (so it lands in the Journal). LIVE only.
    await archivePastActiveDays(userId, dateKey);
  }

  // Create the day once, THEN load everything else — passing the day into the
  // routine service avoids a second concurrent upsert racing the unique.
  const day = await getOrCreateTradingDay(userId, dateKey);
  const [trades, routine, dailyPerf, propFirmAccountsRaw, tradeFormOptions, opportunities, assetAnalyses, reviewCommitments, sessionWindows] =
    await Promise.all([
      listTradesForDay(userId, dateKey),
      getOrCreateDayRoutine(userId, day),
      getDailyAnalytics(userId, dateKey),
      isLive ? listActivePropFirmAccountsForSelector(userId) : Promise.resolve([]),
      getTradeFormOptions(userId),
      listOpportunityDtosForDay(userId, dateKey),
      listDailyAssetAnalyses(userId, dateKey),
      isLive ? getActiveCommitmentsForToday(userId) : Promise.resolve(EMPTY_COMMITMENTS),
      // Today V2 (T3) — session inheritance for a new Trade Idea.
      listStrategySessionWindows(userId),
    ]);

  // Stage 16 §18 / Stage 19 §12 — daily acknowledgement + compact adherence (LIVE only).
  const allSurfacedCommitments = [...reviewCommitments.weekly, ...reviewCommitments.monthly];
  const [dailyStatesMap, adherenceSummaries] =
    allSurfacedCommitments.length > 0
      ? await Promise.all([
          getCommitmentDailyStates(userId, allSurfacedCommitments.map((c) => c.id), dateKeyToUtcDate(dateKey)),
          getAdherenceSummaries(userId, allSurfacedCommitments.map((c) => ({ id: c.id, lineageId: c.lineageId }))),
        ])
      : [new Map(), new Map()];
  const commitmentDailyStates: Record<string, EdgeReviewCommitmentDailyStatus> = Object.fromEntries(dailyStatesMap);
  const commitmentAdherence: Record<string, { current: AdherenceResultDTO; trend: AdherenceTrend }> = Object.fromEntries(adherenceSummaries);

  // Today V3 (Phase 2) — LIVE positions entered on an earlier day that are
  // still open ("carried"), plus the per-trade lifecycle facts the V3 trade
  // list derives state from. Scoped like everything else here, so a
  // Backtesting position can never surface on live Today.
  const carriedRaw = isLive ? await listCarriedOpenTrades(userId, dateKey) : [];
  const lifecycleFacts = isLive
    ? await getTradeLifecycleFacts(userId, [...trades, ...carriedRaw].map((t) => t.id))
    : {};

  const executionsRaw = isLive ? await listExecutionsForTrades(userId, [...trades, ...carriedRaw].map((t) => t.id)) : [];
  const executionsByTradeId: Record<string, ExecutionDTO[]> = {};
  for (const row of executionsRaw) {
    const dto = toExecutionDTO(row);
    (executionsByTradeId[dto.tradeId] ??= []).push(dto);
  }

  // FROM YOUR LAST SESSION — the most recent EARLIER day that left a
  // reflection, by reference (close-day-v3.service.ts documents the rule).
  // TradingDay is workspace-scoped, so in a backtest this only sees the run's
  // own simulated days, and LIVE only sees live days — a simulated day can
  // never leak into Today.
  const carryForward = await getLastSessionCarryForward(userId, dateKey);

  // Today V3 (Phase 4) — the Close phase read model (LIVE only; the
  // Backtesting Session keeps the V2 Day Summary + Close dialog).
  const closeDay = isLive ? await getCloseDayV3(userId, dateKey) : null;

  // Today V3 — Strategy Lab / Performance Account sources for "Today's
  // Rules" (suggested limits, sessions, management reference). LIVE only:
  // the Backtesting Session keeps the V2 workspace, which never reads it.
  const todaysRules: TodaysRulesDTO | null = isLive
    ? await getTodaysRules(
        userId,
        // Via the DTO so a soft-deleted strategy never contributes limits.
        assetAnalyses.map((a) => toDailyAssetAnalysisDTO(a).activeStrategyId).filter((id): id is string => id != null),
      )
    : null;

  // Preparation Score — lazily finalize newly final days and build the read
  // model, then cross the server/client boundary as a plain-JSON view model
  // (Phase 3). LIVE only; it can never block or alter Today — a failure is
  // logged and Today loads without the Preparation summary.
  const preparationNow = new Date();
  const preparation: PreparationDTO | null = isLive
    ? await loadPreparationState(userId, preparationNow)
        .then((state) => toPreparationDTO(state, preparationNow))
        .catch((e) => {
          console.error("[preparation] load failed", e);
          return null;
        })
    : null;

  const dailyAnalytics: DailyAnalyticsDTO = { ...dailyPerf, analyzed: day.analyzedAt != null };

  // Pre-Session/Today's Plan/Day Summary are owned by the TradingDay; Trade
  // Idea/Execution/Review are derived from the day's trades (Today V2 §5).
  const done: WorkflowDoneState = {
    preSession: day.prepCompletedAt != null,
    todaysPlan: day.planCompletedAt != null,
    tradeIdea: trades.length > 0,
    execution: trades.some((t) => t.actualEntry != null),
    review: trades.some((t) => t.reviewedAt != null),
    daySummary: day.analyzedAt != null,
  };

  return {
    day: toTradingDayDTO(day),
    stepStatuses: deriveWorkflowSteps(done),
    routine,
    todaysPlan: toTodaysPlanDTO(day),
    trades: trades.map(toTradeWorkspaceDTO),
    dailyAnalytics,
    propFirmAccounts: propFirmAccountsRaw.map(toAccountAllocationSelectorDTO),
    executionsByTradeId,
    // Account allocation is never offered for a simulated trade.
    tradeFormAccounts: isLive ? tradeFormOptions.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })) : [],
    tradeFormStrategies: tradeFormOptions.strategies.map((s) => ({ id: s.id, name: s.name, version: s.version })),
    opportunities,
    dailyAssetAnalyses: assetAnalyses.map(toDailyAssetAnalysisDTO),
    reviewCommitments,
    commitmentDailyStates,
    commitmentAdherence,
    sessionWindows,
    linkableTrades: trades
      .filter((t) => t.opportunityId == null)
      .map((t) => ({ id: t.id, tradeNumber: t.tradeNumber, assetSymbol: t.assetSymbol, direction: t.direction })),
    carryForward,
    closeDay,
    todaysRules,
    carriedTrades: carriedRaw.map(toTradeWorkspaceDTO),
    lifecycleFacts,
    preparation,
  };
}

export type TradingWorkspaceData = Awaited<ReturnType<typeof load>>;

export async function loadTradingWorkspace(
  userId: string,
  dateKey: string,
  target: WorkspaceLoadTarget,
): Promise<TradingWorkspaceData> {
  if (target.environment === "LIVE") {
    return runLive(() => {
      assertDatabaseSeesScope(LIVE_SCOPE);
      return load(userId, dateKey, true);
    });
  }
  // Ownership is re-verified here — the loader never trusts a bare run id.
  return runInBacktestRun(userId, target.runId, () => load(userId, dateKey, false));
}
