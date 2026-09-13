/**
 * Top-level Actual vs Replay Comparison builder (Stage 15, completed Stage
 * 15.2) — combines period summaries, cumulative R curves, the matched/
 * unmatched decision breakdown, the four-bucket discrepancy summary,
 * override analysis, and category breakdowns into the one model the UI
 * consumes. Pure; the service layer only supplies already-loaded inputs
 * (frozen baseline, ReplayTrade list, manual links, opportunity
 * confirmations, session status).
 *
 * DERIVATION, NOT PERSISTENCE (Stage 15.2 §27) — this entire model is
 * recomputed on every read from: the frozen Actual baseline, the session's
 * ReplayTrade rows, and `ReplayComparisonLink` rows. Nothing here is ever
 * itself persisted as one giant snapshot — that would create a second,
 * potentially stale "truth" alongside the frozen baseline it was built
 * from. Recomputing is cheap (pure in-memory functions over data already
 * loaded) and guarantees Comparison can never drift from its own inputs.
 */
import { toActualPeriodMetrics } from "@/domain/replay-comparison/actual-period-metrics";
import { matchActualToReplayDecisions } from "@/domain/replay-comparison/decision-matching";
import { buildCumulativeRComparison } from "@/domain/replay-comparison/cumulative-r";
import { buildDiscrepancyBuckets } from "@/domain/replay-comparison/discrepancy-buckets";
import { buildOverrideAnalysis } from "@/domain/replay-comparison/override-analysis";
import { buildComparisonBreakdowns } from "@/domain/replay-comparison/category-breakdowns";
import {
  aggregateReplayByAsset,
  aggregateReplayByDirection,
  aggregateReplayBySetupType,
  aggregateReplayByStrategy,
  aggregateReplayByValidationState,
  computeReplayPeriodMetrics,
  countReplayDecisionTypes,
} from "@/domain/replay-comparison/replay-period-metrics";
import type {
  ActualVsReplayComparison,
  BehaviourComparisonSummary,
  ManualComparisonLink,
  OpportunityConfirmation,
} from "@/domain/replay-comparison/types";
import type { ReplayActualBaseline, ReplayTradeDTO } from "@/types/replay";

function ratePercent(count: number, total: number): number | null {
  return total > 0 ? (count / total) * 100 : null;
}

function buildBehaviourComparison(baseline: ReplayActualBaseline, replayTrades: ReplayTradeDTO[]): BehaviourComparisonSummary {
  const actualOverview = baseline.canonical.overview;
  const replayMetrics = computeReplayPeriodMetrics(replayTrades);
  const decisionCounts = countReplayDecisionTypes(replayTrades);

  return {
    actualOverrideRate: actualOverview.overrideRate,
    replayOverrideRate: ratePercent(replayMetrics.overrideCount, replayMetrics.validatedTrades),
    actualValidatedRate: ratePercent(
      baseline.actualTrades.filter((t) => t.validationState === "VALIDATED" || t.validationState === "OVERRIDDEN").length,
      actualOverview.totalExecutedTrades,
    ),
    replayValidatedRate: ratePercent(replayMetrics.validatedTrades, replayMetrics.executedTrades),
    replaySkipRate: ratePercent(decisionCounts.skipped, decisionCounts.taken + decisionCounts.skipped),
  };
}

export function buildActualVsReplayComparison(
  baseline: ReplayActualBaseline,
  replayTrades: ReplayTradeDTO[],
  manualLinks: ManualComparisonLink[] = [],
  opportunityConfirmations: OpportunityConfirmation[] = [],
  opportunityConfirmedAt: Map<string, string | null> = new Map(),
  sessionStatus: "DRAFT" | "IN_PROGRESS" | "COMPLETED" = "IN_PROGRESS",
): ActualVsReplayComparison {
  const { matched, unmatchedActual, unmatchedReplayTaken, unmatchedReplaySkipped } = matchActualToReplayDecisions(
    baseline,
    replayTrades,
    manualLinks,
    opportunityConfirmations,
    opportunityConfirmedAt,
  );

  return {
    sessionStatus,
    isProvisional: sessionStatus !== "COMPLETED",
    actual: { metrics: toActualPeriodMetrics(baseline) },
    replay: {
      metrics: computeReplayPeriodMetrics(replayTrades),
      decisionCounts: countReplayDecisionTypes(replayTrades),
      bySetupType: aggregateReplayBySetupType(replayTrades),
      byStrategy: aggregateReplayByStrategy(replayTrades),
      byDirection: aggregateReplayByDirection(replayTrades),
      byAsset: aggregateReplayByAsset(replayTrades),
      byValidationState: aggregateReplayByValidationState(replayTrades),
    },
    cumulativeR: buildCumulativeRComparison(baseline, replayTrades),
    matched,
    opportunity: { unmatchedActual, unmatchedReplayTaken, unmatchedReplaySkipped },
    behaviour: buildBehaviourComparison(baseline, replayTrades),
    discrepancy: buildDiscrepancyBuckets(matched, unmatchedReplayTaken),
    overrideAnalysis: buildOverrideAnalysis(baseline.actualTrades, replayTrades, matched),
    breakdowns: buildComparisonBreakdowns(baseline.actualTrades, replayTrades),
  };
}
