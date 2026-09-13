/**
 * The four-bucket discrepancy summary (Stage 15.2 §15-20) — Strategy
 * Variance, Execution Discrepancy, Behavioral Discrepancy, Opportunity
 * Discrepancy, kept structurally separate (§19: never merged into one
 * universal number).
 *
 * BUCKET ASSIGNMENT (one matched pair contributes to at most one of
 * Behavioral / Execution / Strategy Variance, checked in that priority
 * order — a pair with no meaningful difference in any of them contributes
 * to none, which is the expected "clean match" case):
 *
 *  1. Behavioral Discrepancy — Actual took what Replay skipped, an
 *     overridden validation, an unvalidated setup taken anyway, or a
 *     frozen NEGATIVE behaviour label. Process/rule divergence — never
 *     converted to an R number (§17).
 *  2. Execution Discrepancy — same decision on both sides, but the
 *     objective entry/stop/exit/partial-management evidence differs
 *     meaningfully. Each category gets an R-cost ONLY when defensibly
 *     computable from frozen prices; otherwise it's recorded as a count
 *     with `costR: null` (§16).
 *  3. Strategy Variance — same decision, no meaningful execution
 *     difference, yet the outcome differs. Counted, never priced (§15).
 *
 * Opportunity Discrepancy is independent of matched pairs entirely — it
 * only ever contains CONFIRMED missed opportunities (§18).
 */
import type {
  AvoidableDiscrepancySummary,
  BehavioralDiscrepancyEvent,
  DiscrepancyBuckets,
  ExecutionDiscrepancyEvent,
  MatchedDecisionPair,
  OpportunityDiscrepancySummary,
  StrategyVarianceEntry,
  UnmatchedReplayEntry,
} from "@/domain/replay-comparison/types";

const OUTCOME_EPSILON_R = 0.1;
const EXECUTION_EPSILON_R = 0.1;
const STOP_WIDENING_RATIO = 1.1; // 10%+ wider than Replay's risk unit

export const AVOIDABLE_DISCREPANCY_FORMULA =
  "Sum of Execution Discrepancy event R-costs that were objectively computed from frozen entry/stop/exit prices (entry degradation, premature close). Excludes stop-widening (recorded structurally, no R-cost attributed), Strategy Variance, unconfirmed Potential Missed Opportunities, and the raw Actual-vs-Replay outcome gap.";

function behaviouralEventFor(pair: MatchedDecisionPair): BehavioralDiscrepancyEvent | null {
  if (pair.behaviour.actualTookReplaySkipped && pair.behaviour.actualOverridden) {
    return {
      dateKey: pair.dateKey,
      assetSymbol: pair.assetSymbol,
      category: "OVERRIDE_VS_SKIP",
      description: "Actual took the trade on an overridden validation; Replay's process was to skip it.",
    };
  }
  if (pair.decision.actualValidationState === "NOT_VALIDATED") {
    return {
      dateKey: pair.dateKey,
      assetSymbol: pair.assetSymbol,
      category: "INVALID_SETUP_TAKEN",
      description: "Actual took the trade without the setup passing validation.",
    };
  }
  const negativeLabel = pair.behaviour.actualBehaviourLabels.find((l) => l.polarity === "NEGATIVE");
  if (negativeLabel) {
    return {
      dateKey: pair.dateKey,
      assetSymbol: pair.assetSymbol,
      category: "BEHAVIOUR_LABEL_EVIDENCE",
      description: `Actual trade carries the "${negativeLabel.name}" behaviour label.`,
    };
  }
  if (pair.behaviour.actualTookReplaySkipped) {
    // Replay skipped for a reason other than an override/negative label —
    // still worth a factual note, no category verdict attached.
    return {
      dateKey: pair.dateKey,
      assetSymbol: pair.assetSymbol,
      category: "OVERRIDE_VS_SKIP",
      description: "Actual took the trade; Replay's process was to skip it.",
    };
  }
  return null;
}

function executionEventsFor(pair: MatchedDecisionPair): ExecutionDiscrepancyEvent[] {
  if (!pair.execution.comparable) return [];
  const events: ExecutionDiscrepancyEvent[] = [];
  const direction = pair.decision.actualDirection;

  const { entry, initialStop } = pair.execution;
  if (entry.actual != null && entry.replay != null && entry.rDistance != null) {
    const actualWorse = direction === "LONG" ? entry.actual > entry.replay : entry.actual < entry.replay;
    const magnitude = Math.abs(entry.rDistance);
    if (actualWorse && magnitude >= EXECUTION_EPSILON_R) {
      events.push({
        dateKey: pair.dateKey,
        assetSymbol: pair.assetSymbol,
        category: "ENTRY_DEGRADATION",
        costR: magnitude,
        description: `Actual entered ${magnitude.toFixed(2)}R worse than Replay's simulated entry.`,
      });
    }
  }

  if (entry.actual != null && initialStop.actual != null && entry.replay != null && initialStop.replay != null) {
    const actualRisk = Math.abs(entry.actual - initialStop.actual);
    const replayRisk = Math.abs(entry.replay - initialStop.replay);
    if (replayRisk > 0 && actualRisk > replayRisk * STOP_WIDENING_RATIO) {
      const widerByR = (actualRisk - replayRisk) / replayRisk;
      events.push({
        dateKey: pair.dateKey,
        assetSymbol: pair.assetSymbol,
        category: "STOP_WIDENING",
        // Structural fact only — never priced as a realized-R cost (§16).
        costR: null,
        description: `Actual's risk distance was ${(widerByR * 100).toFixed(0)}% wider than Replay's.`,
      });
    }
  }

  if (pair.execution.actualHadPartials !== pair.execution.replayHadPartials) {
    events.push({
      dateKey: pair.dateKey,
      assetSymbol: pair.assetSymbol,
      category: "PARTIAL_NOT_FOLLOWED",
      costR: null,
      description: pair.execution.replayHadPartials
        ? "Replay's plan used partial exits; Actual closed the position in one piece."
        : "Actual used partial exits; Replay's simulated management closed in one piece.",
    });
  } else if (
    pair.execution.samePartialManagementShape &&
    !pair.execution.actualHadPartials &&
    pair.execution.actualFullExit != null &&
    pair.execution.replayFullExit != null &&
    pair.execution.actualRealizedR != null &&
    pair.execution.actualRealizedR > 0 &&
    entry.actual != null &&
    initialStop.actual != null
  ) {
    const actualRisk = Math.abs(entry.actual - initialStop.actual);
    const capturedDiff =
      direction === "LONG"
        ? pair.execution.replayFullExit - pair.execution.actualFullExit
        : pair.execution.actualFullExit - pair.execution.replayFullExit;
    const magnitude = actualRisk > 0 ? capturedDiff / actualRisk : 0;
    if (capturedDiff > 0 && magnitude >= EXECUTION_EPSILON_R) {
      events.push({
        dateKey: pair.dateKey,
        assetSymbol: pair.assetSymbol,
        category: "PREMATURE_CLOSE",
        costR: magnitude,
        description: `Actual exited ${magnitude.toFixed(2)}R earlier than Replay's management captured.`,
      });
    }
  }

  return events;
}

export function buildDiscrepancyBuckets(
  matched: MatchedDecisionPair[],
  unmatchedReplayTaken: UnmatchedReplayEntry[],
): DiscrepancyBuckets {
  const strategyVarianceEntries: StrategyVarianceEntry[] = [];
  const executionEvents: ExecutionDiscrepancyEvent[] = [];
  const behavioralEvents: BehavioralDiscrepancyEvent[] = [];

  for (const pair of matched) {
    const behaviouralEvent = behaviouralEventFor(pair);
    if (behaviouralEvent) {
      behavioralEvents.push(behaviouralEvent);
      continue;
    }

    if (pair.classification === "SAME_DECISION") {
      const execEvents = executionEventsFor(pair);
      if (execEvents.length > 0) {
        executionEvents.push(...execEvents);
        continue;
      }

      const deltaR = pair.outcome.deltaR;
      if (deltaR != null && Math.abs(deltaR) >= OUTCOME_EPSILON_R) {
        strategyVarianceEntries.push({
          dateKey: pair.dateKey,
          assetSymbol: pair.assetSymbol,
          actualR: pair.outcome.actualR,
          replayR: pair.outcome.replayR,
          note: "Same decision and execution shape — outcome differs (normal strategy variance).",
        });
      }
    }
  }

  const confirmedMissed = unmatchedReplayTaken.filter((e) => e.missedOpportunityStatus === "CONFIRMED_MISSED");
  const opportunityDiscrepancy: OpportunityDiscrepancySummary = {
    count: confirmedMissed.length,
    totalReplayR: confirmedMissed.reduce((sum, e) => sum + e.replay.realizedReplayR, 0),
    entries: confirmedMissed.map((e) => ({
      replayTradeId: e.replay.id,
      dateKey: e.dateKey,
      assetSymbol: e.assetSymbol,
      strategyName: e.replay.strategyNameSnapshot,
      setupTypeName: e.replay.setupTypeNameSnapshot,
      replayValidationState: e.replay.validationState,
      replayRealizedR: e.replay.realizedReplayR,
      confirmedAt: e.confirmedAt,
    })),
  };

  const totalCostR = executionEvents.reduce((sum, e) => sum + (e.costR ?? 0), 0);
  const avoidableDiscrepancy: AvoidableDiscrepancySummary = { totalR: totalCostR, formula: AVOIDABLE_DISCREPANCY_FORMULA };

  return {
    strategyVariance: { count: strategyVarianceEntries.length, entries: strategyVarianceEntries },
    executionDiscrepancy: { count: executionEvents.length, totalCostR, events: executionEvents },
    behavioralDiscrepancy: { count: behavioralEvents.length, events: behavioralEvents },
    opportunityDiscrepancy,
    avoidableDiscrepancy,
  };
}
