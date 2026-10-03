// Today V3 (Phase 3) — the ONE adapter between the V3 Review and the
// canonical Post-Trade Honest Questionnaire (questions.ts / scoring.ts).
//
// The scorer and its 8 keys are unchanged: V3 only changes WHERE each answer
// comes from, so psychology % stays computed by the same formula for old and
// new trades. Every key is classified as:
//
//  - DERIVED    — Traditorium already knows it; never asked.
//                 fomo            ← Trade.tradeIntent (FOMO → yes, else no)
//                 alignedWithBias ← direction vs Trade.dailyBiasSnapshot
//                                   (asked only when the snapshot is
//                                   NEUTRAL/missing — then it is HUMAN)
//  - EVIDENCE   — Traditorium shows evidence and may suggest an answer, but
//                 the trader must confirm/correct it (riskManaged,
//                 followedExitPlan). A suggestion is never stored on its own.
//  - HUMAN      — only the trader can know (influence questions, monitoring).
//
// Missing data is never interpreted as positive behaviour: a key whose
// source isn't available stays missing, and an incomplete payload is never
// scored (the scorer requires all 8).

import { PSYCHOLOGY_QUESTIONS } from "./questions";

export type PsychologyAnswerValue = string | number;
export type PsychologyAnswerMap = Record<string, PsychologyAnswerValue>;

export type PsychologyKeySource = "DERIVED" | "EVIDENCE" | "HUMAN";

export type TradeIntentValue = "PLANNED" | "FOMO" | "REVENGE" | "BOREDOM" | "IMPULSE" | "MANUAL_OVERRIDE";

export const FOMO_KEY = "fomo";
export const BIAS_KEY = "alignedWithBias";
export const EVIDENCE_KEYS = ["riskManaged", "followedExitPlan"] as const;
export const HUMAN_KEYS = [
  "influencedBySomeoneElseProfit",
  "influencedByOnlineOpinion",
  "outcomeWillInfluenceNext",
  "monitoringObsession",
] as const;

/** FOMO is answered once, by the canonical Trade Intent. Null intent → unknown. */
export function deriveFomoAnswer(intent: TradeIntentValue | null): "yes" | "no" | null {
  if (intent == null) return null;
  return intent === "FOMO" ? "yes" : "no";
}

export type BiasAlignment = "ALIGNED" | "CONFLICT" | "UNKNOWN";

/**
 * Trade direction vs the FROZEN daily Final Bias (Trade.dailyBiasSnapshot —
 * the trader's own final bias for the asset that day, not an independently
 * stored HTF read). NEUTRAL / missing → UNKNOWN (never a false conflict).
 */
export function deriveBiasAlignment(
  direction: "LONG" | "SHORT",
  dailyBiasSnapshot: string | null,
): BiasAlignment {
  if (dailyBiasSnapshot !== "LONG" && dailyBiasSnapshot !== "SHORT") return "UNKNOWN";
  return dailyBiasSnapshot === direction ? "ALIGNED" : "CONFLICT";
}

export interface CanonicalPsychologyInput {
  tradeIntent: TradeIntentValue | null;
  direction: "LONG" | "SHORT";
  dailyBiasSnapshot: string | null;
  /** Answers the trader gave (or confirmed). Values for DERIVED keys are
   *  ignored whenever the derivation is available. */
  trader: PsychologyAnswerMap;
}

export interface CanonicalPsychologyPayload {
  answers: PsychologyAnswerMap;
  sources: Record<string, PsychologyKeySource>;
  /** Keys still needing an answer before the questionnaire can be scored. */
  missing: string[];
  complete: boolean;
}

function validFor(key: string, value: PsychologyAnswerValue | undefined): boolean {
  if (value === undefined) return false;
  const q = PSYCHOLOGY_QUESTIONS.find((x) => x.key === key);
  if (!q) return false;
  if (q.type === "choice") return q.options.some((o) => o.value === value);
  return typeof value === "number" && value >= q.min && value <= q.max;
}

/** Which source each key uses for THIS trade (alignment depends on the snapshot). */
export function psychologyKeySources(
  direction: "LONG" | "SHORT",
  dailyBiasSnapshot: string | null,
): Record<string, PsychologyKeySource> {
  const out: Record<string, PsychologyKeySource> = {};
  for (const q of PSYCHOLOGY_QUESTIONS) {
    if (q.key === FOMO_KEY) out[q.key] = "DERIVED";
    else if (q.key === BIAS_KEY) out[q.key] = deriveBiasAlignment(direction, dailyBiasSnapshot) === "UNKNOWN" ? "HUMAN" : "DERIVED";
    else if ((EVIDENCE_KEYS as readonly string[]).includes(q.key)) out[q.key] = "EVIDENCE";
    else out[q.key] = "HUMAN";
  }
  return out;
}

/** Builds the canonical 8-key payload the existing scorer expects. */
export function buildCanonicalPsychologyAnswers(input: CanonicalPsychologyInput): CanonicalPsychologyPayload {
  const sources = psychologyKeySources(input.direction, input.dailyBiasSnapshot);
  const answers: PsychologyAnswerMap = {};
  const missing: string[] = [];

  for (const q of PSYCHOLOGY_QUESTIONS) {
    let value: PsychologyAnswerValue | undefined;
    if (q.key === FOMO_KEY) {
      value = deriveFomoAnswer(input.tradeIntent) ?? undefined;
    } else if (q.key === BIAS_KEY && sources[q.key] === "DERIVED") {
      value = deriveBiasAlignment(input.direction, input.dailyBiasSnapshot) === "ALIGNED" ? "yes" : "no";
    } else {
      value = input.trader[q.key];
    }
    if (validFor(q.key, value)) answers[q.key] = value as PsychologyAnswerValue;
    else missing.push(q.key);
  }
  return { answers, sources, missing, complete: missing.length === 0 };
}
