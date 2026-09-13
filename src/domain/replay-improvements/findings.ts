/**
 * Review Findings (Stage 16 §3-5, §22-24) — pure synthesis over the Stage
 * 15.2 `ActualVsReplayComparison`. Every finding traces to a specific,
 * already-computed comparison field; this module adds no new comparison
 * math, only groups/describes what Stage 15.2 already found.
 *
 * SEVERITY is evidence strength (recurrence + defensible R impact), never a
 * blame judgment: Strategy Variance and Positive findings are ALWAYS
 * INFORMATIONAL (§4-5) — "not every losing trade needs fixing."
 */
import type { ActualVsReplayComparison, ExecutionDiscrepancyCategory } from "@/domain/replay-comparison/types";
import type { Finding, ImprovementsSummary } from "@/domain/replay-improvements/types";

const rr = (v: number | null) => (v == null ? "0.00R" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);

function severityFor(count: number, rImpact: number | null): "HIGH" | "MEDIUM" | "INFORMATIONAL" {
  if (count >= 3 || (rImpact != null && rImpact >= 1)) return "HIGH";
  if (count >= 2) return "MEDIUM";
  return "INFORMATIONAL";
}

const EXECUTION_CATEGORY_LABEL: Record<ExecutionDiscrepancyCategory, string> = {
  ENTRY_DEGRADATION: "Entry degradation",
  STOP_WIDENING: "Stop widening",
  PREMATURE_CLOSE: "Premature close",
  PARTIAL_NOT_FOLLOWED: "Partial management mismatch",
};

export function deriveExecutionFindings(comparison: ActualVsReplayComparison): Finding[] {
  const byCategory = new Map<ExecutionDiscrepancyCategory, typeof comparison.discrepancy.executionDiscrepancy.events>();
  for (const event of comparison.discrepancy.executionDiscrepancy.events) {
    (byCategory.get(event.category) ?? byCategory.set(event.category, []).get(event.category)!).push(event);
  }

  return Array.from(byCategory.entries()).map(([category, events]) => {
    const withCost = events.filter((e) => e.costR != null);
    const totalCost = withCost.length > 0 ? withCost.reduce((s, e) => s + (e.costR ?? 0), 0) : null;
    const label = EXECUTION_CATEGORY_LABEL[category];
    return {
      key: `EXECUTION_${category}`,
      category: "EXECUTION",
      severity: severityFor(events.length, totalCost),
      statement:
        totalCost != null
          ? `${events.length} ${label.toLowerCase()} event(s) — ${rr(totalCost)} of defensible avoidable discrepancy.`
          : `${events.length} ${label.toLowerCase()} event(s) — structural, no defensible R-cost.`,
      evidence: events.map((e) => `${e.dateKey} ${e.assetSymbol}: ${e.description}`),
      count: events.length,
      rImpact: totalCost,
    };
  });
}

export function deriveBehavioralFindings(comparison: ActualVsReplayComparison): Finding[] {
  const byCategory = new Map<string, typeof comparison.discrepancy.behavioralDiscrepancy.events>();
  for (const event of comparison.discrepancy.behavioralDiscrepancy.events) {
    (byCategory.get(event.category) ?? byCategory.set(event.category, []).get(event.category)!).push(event);
  }

  return Array.from(byCategory.entries()).map(([category, events]) => ({
    key: `BEHAVIOR_${category}`,
    category: "BEHAVIOR",
    severity: severityFor(events.length, null),
    statement: `${events.length} instance(s) of ${category.toLowerCase().replace(/_/g, " ")}.`,
    evidence: events.map((e) => `${e.dateKey} ${e.assetSymbol}: ${e.description}`),
    count: events.length,
    rImpact: null,
  }));
}

/** Only ever built from CONFIRMED missed opportunities — the comparison
 *  layer itself already guarantees `opportunityDiscrepancy` excludes
 *  unconfirmed/rejected entries (§18). */
export function deriveOpportunityFindings(comparison: ActualVsReplayComparison): Finding[] {
  const { opportunityDiscrepancy } = comparison.discrepancy;
  if (opportunityDiscrepancy.count === 0) return [];

  return [
    {
      key: "CONFIRMED_MISSED_OPPORTUNITIES",
      category: "OPPORTUNITY",
      severity: severityFor(opportunityDiscrepancy.count, null),
      statement: `${opportunityDiscrepancy.count} confirmed missed opportunit${opportunityDiscrepancy.count === 1 ? "y" : "ies"} — Replay outcome ${rr(opportunityDiscrepancy.totalReplayR)} (not automatically "avoidable").`,
      evidence: opportunityDiscrepancy.entries.map(
        (e) => `${e.dateKey} ${e.assetSymbol} (${e.strategyName ?? "no strategy"}${e.setupTypeName ? ` / ${e.setupTypeName}` : ""}): Replay ${rr(e.replayRealizedR)}`,
      ),
      count: opportunityDiscrepancy.count,
      rImpact: null,
    },
  ];
}

/** Strategy Variance is always INFORMATIONAL — "not every losing trade
 *  needs fixing" (§5). Never ranked as a behavioral failure. */
export function deriveStrategyVarianceFindings(comparison: ActualVsReplayComparison): Finding[] {
  const { strategyVariance } = comparison.discrepancy;
  if (strategyVariance.count === 0) return [];

  return [
    {
      key: "STRATEGY_VARIANCE",
      category: "STRATEGY_VARIANCE",
      severity: "INFORMATIONAL",
      statement: `${strategyVariance.count} trade(s) showed normal strategy variance this period — same decision and execution, different outcome. No change required.`,
      evidence: strategyVariance.entries.map((e) => `${e.dateKey} ${e.assetSymbol}: Actual ${rr(e.actualR)} vs Replay ${rr(e.replayR)}`),
      count: strategyVariance.count,
      rImpact: null,
    },
  ];
}

/** §23 — positive evidence, never auto-written into the reflection text,
 *  only surfaced as evidence the trader can reference. Every condition here
 *  is gated on comparable data actually existing (never "positive because
 *  there's no data to say otherwise"). */
export function derivePositiveFindings(comparison: ActualVsReplayComparison): Finding[] {
  const findings: Finding[] = [];
  const comparablePairs = comparison.matched.filter((p) => p.execution.comparable);
  const events = comparison.discrepancy.executionDiscrepancy.events;

  if (comparablePairs.length > 0 && events.filter((e) => e.category === "STOP_WIDENING").length === 0) {
    findings.push({
      key: "NO_STOP_WIDENING",
      category: "POSITIVE",
      severity: "INFORMATIONAL",
      statement: `No stop-widening detected across ${comparablePairs.length} matched trade(s) with comparable execution evidence this period.`,
      evidence: [],
      count: comparablePairs.length,
      rImpact: null,
    });
  }

  const { actual, replay } = comparison.overrideAnalysis;
  if (actual.overridden + actual.validated > 0 && replay.overridden < actual.overridden) {
    findings.push({
      key: "FEWER_REPLAY_OVERRIDES",
      category: "POSITIVE",
      severity: "INFORMATIONAL",
      statement: `Replay used fewer overrides than Actual this period (${replay.overridden} vs ${actual.overridden}).`,
      evidence: [],
      count: actual.overridden - replay.overridden,
      rImpact: null,
    });
  }

  const anyPartials = comparablePairs.some((p) => p.execution.actualHadPartials || p.execution.replayHadPartials);
  if (anyPartials && events.filter((e) => e.category === "PARTIAL_NOT_FOLLOWED").length === 0) {
    findings.push({
      key: "PARTIALS_FOLLOWED",
      category: "POSITIVE",
      severity: "INFORMATIONAL",
      statement: "Partial-exit management matched between Actual and Replay wherever partials were used this period.",
      evidence: [],
      count: comparablePairs.filter((p) => p.execution.actualHadPartials || p.execution.replayHadPartials).length,
      rImpact: null,
    });
  }

  return findings;
}

export function buildImprovementsSummary(comparison: ActualVsReplayComparison, suggestedCommitmentCount: number): ImprovementsSummary {
  return {
    executionFindingCount: comparison.discrepancy.executionDiscrepancy.count,
    behaviorFindingCount: comparison.discrepancy.behavioralDiscrepancy.count,
    confirmedMissedOpportunityCount: comparison.discrepancy.opportunityDiscrepancy.count,
    avoidableDiscrepancyR: comparison.discrepancy.avoidableDiscrepancy.totalR,
    suggestedCommitmentCount,
  };
}
