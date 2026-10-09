/**
 * Trading Psychology Reset — answers and the recommendation (pure).
 *
 * The recommendation is advice, never a gate: it cannot unlock, relax or
 * replace any risk control. An existing day limit always takes precedence.
 * Completing a reset is never treated as proof of readiness to trade.
 */
import { nextActionStep, type CautionLevel, type ResetFlow, type ResetSignal } from "./flows";

export interface ResetAnswer {
  optionId: string;
  /** Optional written reflection. */
  note?: string;
  answeredAt: string;
}

export type ResetAnswers = Record<string, ResetAnswer>;

export const REFLECTION_MAX = 500;

export function validateAnswer(flow: ResetFlow, stepId: string, optionId: string, note?: string | null): string | null {
  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) return "Unknown question.";
  if (!step.options.some((o) => o.id === optionId)) return "Choose one of the answers.";
  if (note != null && note.length > REFLECTION_MAX) return `Keep the reflection under ${REFLECTION_MAX} characters.`;
  return null;
}

/** Signals from the answers currently given, in step order. */
export function signalsFrom(flow: ResetFlow, answers: ResetAnswers): Set<ResetSignal> {
  const out = new Set<ResetSignal>();
  for (const step of flow.steps) {
    const option = step.options.find((o) => o.id === answers[step.id]?.optionId);
    for (const s of option?.signals ?? []) out.add(s);
  }
  return out;
}

/** True when every step has a valid answer (the summary can be shown). */
export function isComplete(flow: ResetFlow, answers: ResetAnswers): boolean {
  return flow.steps.every((s) => s.options.some((o) => o.id === answers[s.id]?.optionId));
}

export type Recommendation = "CONTINUE_WITH_RULES" | "COOLDOWN" | "STOP_SESSION";

const LEVEL: Record<Recommendation, CautionLevel> = { CONTINUE_WITH_RULES: 0, COOLDOWN: 1, STOP_SESSION: 2 };

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  CONTINUE_WITH_RULES: "Continue only with a valid setup — or keep waiting",
  COOLDOWN: "Take a cooldown before reassessing",
  STOP_SESSION: "Stop trading for this session",
};

export interface DayLimitContext {
  /** True once today's daily risk or max-trades limit is reached (Today's existing limits). */
  reached: boolean;
  /** Plain-language description of the reached limit(s). */
  messages: string[];
}

export interface ResetAssessment {
  recommendation: Recommendation;
  /** Why — one line per contributing answer or limit. */
  reasons: string[];
  /** The trader's own next-action choice (final step), if answered. */
  chosen: { optionId: string; label: string; caution: CautionLevel } | null;
  /** The choice is less cautious than the recommendation — shown, never enforced. */
  lessCautiousThanRecommended: boolean;
  /** An existing day limit is reached and takes precedence over any choice here. */
  limitPrecedence: DayLimitContext | null;
}

/**
 * The recommended next action:
 *   • a reached day limit → stop (the existing restriction takes precedence);
 *   • a reported rule break while still emotionally activated → stop;
 *   • an urge to recover / chase, FOMO, reacting to the last result,
 *     struggling to accept, or an unclear feeling → cooldown;
 *   • otherwise → continue only with a valid setup (waiting stays legitimate).
 */
export function assessReset(flow: ResetFlow, answers: ResetAnswers, limits: DayLimitContext | null = null): ResetAssessment {
  const signals = signalsFrom(flow, answers);
  const reasons: string[] = [];
  let recommendation: Recommendation = "CONTINUE_WITH_RULES";
  const raise = (r: Recommendation, why: string) => {
    if (LEVEL[r] > LEVEL[recommendation]) recommendation = r;
    reasons.push(why);
  };

  const urge = signals.has("RECOVERY_URGE") || signals.has("FOMO") || signals.has("REACTIVE");
  const activated = urge || signals.has("STRUGGLING") || signals.has("UNSURE_FEELING");

  if (limits?.reached) raise("STOP_SESSION", "Today's limit is reached. That restriction takes precedence over anything here.");
  if (signals.has("RULE_BREAK") && activated) {
    raise("STOP_SESSION", "You reported breaking a rule and still feeling pulled toward trading. Stepping away protects your next decision.");
  } else if (signals.has("RULE_BREAK")) {
    reasons.push("You reported breaking a rule. Review that trade before relying on the same setup again.");
  }
  if (signals.has("RECOVERY_URGE")) raise("COOLDOWN", "You reported an urge to recover or chase. That is a signal to pause, not to trade.");
  if (signals.has("FOMO")) raise("COOLDOWN", "You reported fear of missing the next move. A pause costs very little.");
  if (signals.has("REACTIVE")) raise("COOLDOWN", "You may be reacting to what just happened rather than to the market in front of you.");
  if (signals.has("STRUGGLING")) raise("COOLDOWN", "You are still working through this outcome.");
  if (signals.has("UNSURE_FEELING")) raise("COOLDOWN", "You weren't sure what you were feeling. Time away tends to make that clearer.");
  if (signals.has("EXECUTION_ISSUE")) reasons.push("You noted an execution issue. It is worth reviewing later, calmly.");
  if (signals.has("EXECUTION_UNSURE")) reasons.push("You weren't sure about execution. Check it against your plan when you review.");
  if (signals.has("NO_SETUP")) reasons.push("There is no valid setup right now, so waiting is the correct decision.");

  const step = nextActionStep(flow);
  const option = step.options.find((o) => o.id === answers[step.id]?.optionId);
  const chosen = option ? { optionId: option.id, label: option.label, caution: option.caution ?? 0 } : null;

  return {
    recommendation,
    reasons,
    chosen,
    lessCautiousThanRecommended: chosen != null && chosen.caution < LEVEL[recommendation],
    limitPrecedence: limits?.reached ? limits : null,
  };
}
