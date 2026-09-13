/**
 * Deterministic, rule-based commitment suggestions (Stage 16 §9-13) — NOT
 * AI coaching (§30): every suggestion is a named, fixed rule with a minimum
 * evidence threshold, traceable back to the exact comparison events that
 * produced it. The trader must explicitly Add/Edit/Dismiss each one (§9);
 * nothing here is ever auto-persisted as a commitment.
 *
 * MINIMUM EVIDENCE (§11): every numeric-pattern rule requires at least 2
 * occurrences — a single normal loss, one unconfirmed missed opportunity,
 * or Strategy Variance alone never produces a suggestion. The one exception
 * is a frozen NEGATIVE behaviour label (§13's "single minor issue worth
 * observing" example) — the trader already self-flagged that trade, so a
 * single occurrence is real evidence, not noise; it surfaces at LOW
 * priority only.
 *
 * DEDUPLICATION (§12): each rule has a stable `ruleKey` and aggregates ALL
 * matching events into exactly one suggestion — "do not widen the stop",
 * "keep SL fixed", etc. are never separately generated, because there is
 * only ever one STOP_WIDENING rule.
 */
import type { SuggestedCommitment } from "@/domain/replay-improvements/types";
import type { ActualVsReplayComparison, ExecutionDiscrepancyEvent } from "@/domain/replay-comparison/types";

const MIN_REPEAT = 2;
const rr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;

function priorityFor(count: number, rImpact: number | null): "HIGH" | "MEDIUM" {
  return count >= 3 || (rImpact != null && rImpact >= 1) ? "HIGH" : "MEDIUM";
}

function executionRuleSuggestion(
  events: ExecutionDiscrepancyEvent[],
  ruleKey: string,
  findingKey: string,
  title: string,
  description: string,
): SuggestedCommitment | null {
  if (events.length < MIN_REPEAT) return null;
  const withCost = events.filter((e) => e.costR != null);
  const totalCost = withCost.length > 0 ? withCost.reduce((s, e) => s + (e.costR ?? 0), 0) : null;
  const evidence = [`${events.length} occurrence(s) this period`];
  if (totalCost != null) evidence.push(`${rr(totalCost)} of defensible avoidable discrepancy`);
  return {
    ruleKey,
    category: "EXECUTION",
    title,
    description,
    priority: priorityFor(events.length, totalCost),
    evidence,
    sourceFindingKeys: [findingKey],
  };
}

export function deriveSuggestedCommitments(comparison: ActualVsReplayComparison): SuggestedCommitment[] {
  const suggestions: SuggestedCommitment[] = [];
  const execEvents = comparison.discrepancy.executionDiscrepancy.events;
  const byExecCategory = (category: string) => execEvents.filter((e) => e.category === category);

  const stopWidening = executionRuleSuggestion(
    byExecCategory("STOP_WIDENING"),
    "STOP_WIDENING_PATTERN",
    "EXECUTION_STOP_WIDENING",
    "Do not widen the stop after entry",
    "Actual's risk distance was meaningfully wider than Replay's simulated management on repeated trades this period.",
  );
  if (stopWidening) suggestions.push(stopWidening);

  const prematureClose = executionRuleSuggestion(
    byExecCategory("PREMATURE_CLOSE"),
    "PREMATURE_CLOSE_PATTERN",
    "EXECUTION_PREMATURE_CLOSE",
    "Follow planned target structure unless invalidation changes",
    "Actual exited winning trades earlier than Replay's planned management on repeated trades, giving up defensible R.",
  );
  if (prematureClose) suggestions.push(prematureClose);

  const overrideEvents = comparison.discrepancy.behavioralDiscrepancy.events.filter((e) => e.category === "OVERRIDE_VS_SKIP");
  if (overrideEvents.length >= MIN_REPEAT) {
    suggestions.push({
      ruleKey: "OVERRIDE_DISCIPLINE",
      category: "BEHAVIOR",
      title: "Reduce discretionary overrides",
      description: "Actual took several trades on an overridden validation, or where Replay's disciplined process was to skip, this period.",
      priority: priorityFor(overrideEvents.length, null),
      evidence: [`${overrideEvents.length} occurrence(s) this period`],
      sourceFindingKeys: ["BEHAVIOR_OVERRIDE_VS_SKIP"],
    });
  }

  const confirmedMissed = comparison.discrepancy.opportunityDiscrepancy;
  if (confirmedMissed.count >= MIN_REPEAT) {
    suggestions.push({
      ruleKey: "MISSED_OPPORTUNITY_DISCIPLINE",
      category: "OPPORTUNITY",
      title: "Act on validated setups that meet the full checklist",
      description: "Multiple confirmed missed opportunities this period were valid, checklist-passing Replay setups Actual did not take.",
      priority: priorityFor(confirmedMissed.count, null),
      evidence: [`${confirmedMissed.count} confirmed missed opportunit${confirmedMissed.count === 1 ? "y" : "ies"}`, `Replay outcome: ${rr(confirmedMissed.totalReplayR)}`],
      sourceFindingKeys: ["CONFIRMED_MISSED_OPPORTUNITIES"],
    });
  }

  const negativeLabelEvents = comparison.discrepancy.behavioralDiscrepancy.events.filter((e) => e.category === "BEHAVIOUR_LABEL_EVIDENCE");
  if (negativeLabelEvents.length >= 1) {
    suggestions.push({
      ruleKey: "BEHAVIOUR_LABEL_PATTERN",
      category: "BEHAVIOR",
      title: "Review flagged behaviour pattern",
      description: "At least one Actual trade this period carries a frozen negative behaviour label — worth a deliberate look, even as a single instance.",
      priority: negativeLabelEvents.length >= 2 ? "MEDIUM" : "LOW",
      evidence: negativeLabelEvents.map((e) => e.description),
      sourceFindingKeys: ["BEHAVIOR_BEHAVIOUR_LABEL_EVIDENCE"],
    });
  }

  return suggestions;
}
