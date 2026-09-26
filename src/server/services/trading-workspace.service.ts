import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { prisma } from "@/server/db";
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
import type { DailyAnalyticsDTO } from "@/types/today";
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

export interface CarryForwardDTO {
  fromDateKey: string;
  carryForward: string | null;
  mainLesson: string | null;
  toImprove: string | null;
}

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

  const executionsRaw = isLive ? await listExecutionsForTrades(userId, trades.map((t) => t.id)) : [];
  const executionsByTradeId: Record<string, ExecutionDTO[]> = {};
  for (const row of executionsRaw) {
    const dto = toExecutionDTO(row);
    (executionsByTradeId[dto.tradeId] ??= []).push(dto);
  }

  // Refinement inside a run: the most recent EARLIER simulated day that left a reflection.
  let carryForward: CarryForwardDTO | null = null;
  if (!isLive) {
    const previous = await prisma.tradingDay.findFirst({
      where: {
        userId,
        date: { lt: dateKeyToUtcDate(dateKey) },
        OR: [{ dayCarryForward: { not: null } }, { dayMainLesson: { not: null } }, { dayToImprove: { not: null } }],
      },
      orderBy: { date: "desc" },
      select: { date: true, dayCarryForward: true, dayMainLesson: true, dayToImprove: true },
    });
    if (previous) {
      carryForward = {
        fromDateKey: utcDateToKey(previous.date),
        carryForward: previous.dayCarryForward,
        mainLesson: previous.dayMainLesson,
        toImprove: previous.dayToImprove,
      };
    }
  }

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
