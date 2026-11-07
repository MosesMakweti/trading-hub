/**
 * 🎯 Perfect Plan Adherence — when a trade was executed exactly to plan (pure).
 *
 * Built only from data Traditorium already captures; PnL, R, win/loss and
 * the result of the trade are NEVER inputs. A losing trade that followed
 * every rule qualifies; a winning trade that broke one does not.
 *
 * Two kinds of evidence:
 *
 *  OBJECTIVE (recorded by the system at the time — disqualify immediately)
 *   • setupValid = false — a mandatory strategy confluence was missing
 *   • validationState = OVERRIDDEN — the Setup Validation shield was overridden
 *   • limitOverrideReason — the trade knowingly exceeded today's confirmed
 *     max trades / daily risk
 *   • direction against the trader's own frozen daily Final Bias for the asset
 *   • the stop was moved wider than the initial stop
 *   • the motive was impulsive (FOMO, revenge, boredom, impulse, manual override)
 *
 *  THE TRADER'S OWN JUDGEMENT (from the completed final review)
 *   • all four process answers are "yes": followed strategy, entry model,
 *     trade-management rules, remained patient
 *   • risk managed per plan / followed the exit plan — when answered in the
 *     psychology review, neither may be "no"
 *   • motive = PLANNED
 *
 * A trade without a completed final review is AWAITING_REVIEW (unless an
 * objective violation already decides it): the trader's confirmation is
 * required before any adherence credit is given.
 */
import { ADHERENCE_QUESTIONS } from "@/domain/trades/adherence";
import type { BiasAlignment } from "@/domain/psychology/review-adapter";

export interface PlanAdherenceFacts {
  /** An actual position was taken (entered, or a legacy recorded result) and not cancelled. */
  executed: boolean;
  /** Centralized review state is FINAL_REVIEW_COMPLETE. */
  reviewComplete: boolean;
  adherenceAnswers: Record<string, boolean>;
  tradeIntent: string | null;
  setupValid: boolean | null;
  validationState: string | null;
  hasLimitOverride: boolean;
  biasAlignment: BiasAlignment;
  stopWidened: boolean | null;
  /** Psychology review answers ("yes" | "no"), when the questionnaire was scored. */
  riskManaged: string | null;
  followedExitPlan: string | null;
}

export type PlanAdherenceStatus = "NOT_APPLICABLE" | "AWAITING_REVIEW" | "PERFECT" | "VIOLATED";

export interface AdherenceViolation {
  key: string;
  label: string;
}

export interface PlanAdherenceResult {
  status: PlanAdherenceStatus;
  violations: AdherenceViolation[];
}

const IMPULSIVE_INTENT_LABEL: Record<string, string> = {
  FOMO: "Entered out of FOMO",
  REVENGE: "Revenge trade",
  BOREDOM: "Traded out of boredom",
  IMPULSE: "Impulsive entry",
  MANUAL_OVERRIDE: "Manually overrode the plan",
};

/**
 * Violation keys that are about RISK rather than the plan itself. Goals use
 * this to split plan adherence into "followed my plan" and "respected my
 * risk"; the Discipline adherence track still treats every key as one set.
 */
export const RISK_VIOLATION_KEYS: ReadonlySet<string> = new Set(["limitOverride", "stopWidened", "riskManaged", "followedExitPlan"]);

/**
 * Every violation of a trade, split by evidence kind. `objective` is known as
 * soon as the trade is recorded; `judged` is only meaningful once the final
 * review is complete (before that it is empty).
 */
export function collectAdherenceViolations(f: PlanAdherenceFacts): { objective: AdherenceViolation[]; judged: AdherenceViolation[] } {
  if (!f.executed) return { objective: [], judged: [] };
  return { objective: objectiveViolations(f), judged: f.reviewComplete ? judgedViolations(f) : [] };
}

export function evaluatePlanAdherence(f: PlanAdherenceFacts): PlanAdherenceResult {
  if (!f.executed) return { status: "NOT_APPLICABLE", violations: [] };

  const objective = objectiveViolations(f);
  if (objective.length > 0) return { status: "VIOLATED", violations: objective };
  if (!f.reviewComplete) return { status: "AWAITING_REVIEW", violations: [] };

  const judged = judgedViolations(f);
  return judged.length === 0 ? { status: "PERFECT", violations: [] } : { status: "VIOLATED", violations: judged };
}

function objectiveViolations(f: PlanAdherenceFacts): AdherenceViolation[] {
  const objective: AdherenceViolation[] = [];
  if (f.setupValid === false) objective.push({ key: "setupInvalid", label: "A mandatory setup condition was missing" });
  if (f.validationState === "OVERRIDDEN") objective.push({ key: "setupOverridden", label: "Setup validation was overridden" });
  if (f.hasLimitOverride) objective.push({ key: "limitOverride", label: "Exceeded today's trade or risk limit" });
  if (f.biasAlignment === "CONFLICT") objective.push({ key: "againstBias", label: "Traded against the day's final bias" });
  if (f.stopWidened === true) objective.push({ key: "stopWidened", label: "Stop moved wider than planned" });
  if (f.tradeIntent != null && IMPULSIVE_INTENT_LABEL[f.tradeIntent]) {
    objective.push({ key: "impulsiveIntent", label: IMPULSIVE_INTENT_LABEL[f.tradeIntent] });
  }
  return objective;
}

function judgedViolations(f: PlanAdherenceFacts): AdherenceViolation[] {
  const judged: AdherenceViolation[] = [];
  if (f.tradeIntent !== "PLANNED") judged.push({ key: "notPlanned", label: "Not a planned trade" });
  for (const q of ADHERENCE_QUESTIONS) {
    if (f.adherenceAnswers[q.key] !== true) judged.push({ key: `adherence.${q.key}`, label: q.prompt.replace(/^Did I /, "Did not ").replace(/\?$/, "") });
  }
  if (f.riskManaged === "no") judged.push({ key: "riskManaged", label: "Risk not managed per plan" });
  if (f.followedExitPlan === "no") judged.push({ key: "followedExitPlan", label: "Exit plan not followed" });
  return judged;
}

/** The plain-language rule list shown to the trader (transparency). */
export const PLAN_ADHERENCE_RULES: readonly string[] = [
  "Final review completed, with every process answer “Yes” (strategy, entry model, trade management, patience)",
  "Motive was Planned — not FOMO, revenge, boredom, impulse or a manual override",
  "Setup was valid and setup validation was not overridden",
  "Today's max-trades and daily-risk limits were respected",
  "Direction agreed with your final bias for the asset (when you set one)",
  "Stop never moved wider than the initial stop; risk and exit plan followed",
];
