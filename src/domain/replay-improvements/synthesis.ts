import {
  buildImprovementsSummary,
  deriveBehavioralFindings,
  deriveExecutionFindings,
  deriveOpportunityFindings,
  derivePositiveFindings,
  deriveStrategyVarianceFindings,
} from "@/domain/replay-improvements/findings";
import { deriveSuggestedCommitments } from "@/domain/replay-improvements/suggestions";
import type { ImprovementsSynthesis } from "@/domain/replay-improvements/types";
import type { ActualVsReplayComparison } from "@/domain/replay-comparison/types";

/** The one entry point the Improvements page/service calls — runs every
 *  pure deriver once over the same comparison (Stage 16 §3). */
export function synthesizeImprovements(comparison: ActualVsReplayComparison): ImprovementsSynthesis {
  const findings = [...deriveExecutionFindings(comparison), ...deriveBehavioralFindings(comparison), ...deriveOpportunityFindings(comparison)];
  const suggestions = deriveSuggestedCommitments(comparison);

  return {
    summary: buildImprovementsSummary(comparison, suggestions.length),
    findings,
    positiveFindings: derivePositiveFindings(comparison),
    strategyVarianceFindings: deriveStrategyVarianceFindings(comparison),
    suggestions,
  };
}
