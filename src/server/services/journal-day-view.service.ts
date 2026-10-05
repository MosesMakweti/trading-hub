import { getJournalDayRecap } from "@/server/services/journal.service";
import { getTradeFormOptions, listTradesForDay } from "@/server/services/trades.service";
import { listOpportunityDtosForDay } from "@/server/services/opportunity.service";
import { getDayCloseSummary } from "@/server/services/close-day.service";
import { listDailyAssetAnalyses, toDailyAssetAnalysisDTO } from "@/server/services/daily-asset-analysis.service";
import { getTradingDay, toTodaysPlanDTO } from "@/server/services/trading-day.service";
import { listBehaviourLabelsForTrades, type TradeBehaviourLabelSummaryDTO } from "@/server/services/behaviour-labels.service";
import { executionSnapshot, resolveSelectedTags } from "@/server/services/selected-tags";
import { toTradeDiscrepancy } from "@/server/services/trade-discrepancy";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import type { SetupValidationSnapshot } from "@/domain/trades/setup-validation";
import type { TradeListItemDTO } from "@/types/trades";

/**
 * The ONE loader behind a Journal day (Backtesting Stage 5), shared by the live
 * Journal (`/journal/[date]`) and the Backtesting Journal
 * (`/backtesting/[runId]/journal/[date]`). Environment comes from the ambient
 * workspace scope, exactly like the Today loader — so the same code returns
 * a live day or one simulated day of one run. Strictly READ-ONLY: it never
 * creates a TradingDay (getTradingDay, not getOrCreate), so viewing a date
 * leaves no trace.
 *
 * `historical: false` skips the closing-summary/label reads for the live
 * "today" callout case, which renders the live workspace elsewhere.
 */
export async function loadJournalDay(userId: string, dateKey: string, { historical }: { historical: boolean }) {
  const [trades, recap, opportunities, formOptions, day, assetAnalyses] = await Promise.all([
    listTradesForDay(userId, dateKey),
    getJournalDayRecap(userId, dateKey),
    listOpportunityDtosForDay(userId, dateKey),
    getTradeFormOptions(userId),
    getTradingDay(userId, dateKey),
    listDailyAssetAnalyses(userId, dateKey),
  ]);

  const [daySummary, behaviourLabelsByTrade] = historical
    ? await Promise.all([getDayCloseSummary(userId, dateKey), listBehaviourLabelsForTrades(userId, trades.map((t) => t.id))])
    : [null, {} as Record<string, TradeBehaviourLabelSummaryDTO[]>];

  // Workflow recap (only for days that were opened in the workflow).
  let recapStatuses: ReturnType<typeof deriveWorkflowSteps> = [];
  if (recap) {
    const done: WorkflowDoneState = {
      preSession: recap.prepDone,
      todaysPlan: recap.planDone,
      tradeIdea: trades.length > 0,
      execution: trades.some((t) => t.actualEntry != null),
      review: trades.some((t) => t.reviewedAt != null),
      daySummary: recap.analyzeDone,
    };
    recapStatuses = deriveWorkflowSteps(done);
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
      dailyBiasSnapshot: (t.dailyBiasSnapshot as TradeListItemDTO["dailyBiasSnapshot"]) ?? null,
      hasActualEntry: t.actualEntry != null,
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
      confluenceLabels: resolveSelectedTags(t.selectedConfluences, executionSnapshot(t.strategyExecutionSnapshot).confluences, []),
      executionLabels: resolveSelectedTags(t.selectedExecution, executionSnapshot(t.strategyExecutionSnapshot).execution, []),
      tradeQualityPercent: t.tradeQualityPercent,
      setupScore: t.setupScore,
      setupRating: t.setupRating as TradeListItemDTO["setupRating"],
      setupValid: t.setupValid,
      discrepancy: toTradeDiscrepancy(t),
      psychology: t.psychology
        ? { rawScore: t.psychology.rawScore, percent: t.psychology.psychologyPercent, grade: t.psychology.grade }
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

  return {
    recap,
    recapStatuses,
    daySummary,
    plan: day ? toTodaysPlanDTO(day) : null,
    assetAnalyses: assetAnalyses.map(toDailyAssetAnalysisDTO),
    opportunities,
    trades: tradeDtos,
    strategyOptions: formOptions.strategies.map((s) => ({ id: s.id, name: s.name, version: s.version })),
    linkableTrades: trades
      .filter((t) => t.opportunityId == null)
      .map((t) => ({ id: t.id, tradeNumber: t.tradeNumber, assetSymbol: t.assetSymbol, direction: t.direction })),
  };
}

export type JournalDayData = Awaited<ReturnType<typeof loadJournalDay>>;
