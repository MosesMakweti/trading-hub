/**
 * Strategy-adherence self-scoring (Phase 5). Five fixed yes/no questions asking
 * whether the trader actually followed their process on a given trade. Kept in
 * code (not the DB) so the question set and the scoring are canonical, mirroring
 * how the psychology questionnaire is handled.
 *
 * Framework-free (no next/react/prisma) — unit-tested.
 */

export interface AdherenceQuestion {
  key: string;
  prompt: string;
}

// Today V2 Phase 2 §13 — "executedToPlan" ("Did I execute according to
// plan?") was removed: Traditorium already knows this objectively, from the
// Trade Review comparison panel's planned-vs-actual entry/stop/exit deltas
// (trade-review.service.ts's getTradeReviewData) — asking the trader to
// self-report the same fact as a yes/no duplicated a machine-observed
// answer. Historical answers already recorded under this key are left alone
// in the database (sanitizeAdherenceAnswers simply stops recognizing the key
// going forward, the same way a future question-set change already handles
// unknown keys per its own doc comment below); the remaining four questions
// are all genuinely subjective judgments the system has no objective signal
// for (strategy/entry-model/trade-management "compliance" as a holistic
// call, and patience, are not reducible to the objective comparison data).
export const ADHERENCE_QUESTIONS: AdherenceQuestion[] = [
  { key: "followedStrategy", prompt: "Did I follow my strategy?" },
  { key: "followedEntryModel", prompt: "Did I follow my entry model?" },
  { key: "followedTradeManagement", prompt: "Did I follow my trade-management rules?" },
  { key: "remainedPatient", prompt: "Did I remain patient?" },
];

const ADHERENCE_KEYS = new Set(ADHERENCE_QUESTIONS.map((q) => q.key));

/** A partial map of answers; a key is present only once the trader answers it. */
export type AdherenceAnswers = Record<string, boolean>;

export interface AdherenceScore {
  yesCount: number;
  answeredCount: number;
  total: number;
  /** Percent of *answered* questions marked yes; null until at least one answer. */
  percent: number | null;
}

/**
 * Scores adherence over the questions actually answered, so recording only some
 * answers isn't penalised as if the rest were "no". Unknown keys are ignored so a
 * future change to the question set can't corrupt the score of an old trade.
 */
export function scoreAdherence(answers: AdherenceAnswers | null | undefined): AdherenceScore {
  const total = ADHERENCE_QUESTIONS.length;
  if (!answers) return { yesCount: 0, answeredCount: 0, total, percent: null };

  let answeredCount = 0;
  let yesCount = 0;
  for (const key of ADHERENCE_KEYS) {
    if (key in answers && typeof answers[key] === "boolean") {
      answeredCount += 1;
      if (answers[key]) yesCount += 1;
    }
  }

  return {
    yesCount,
    answeredCount,
    total,
    percent: answeredCount === 0 ? null : Math.round((yesCount / answeredCount) * 100),
  };
}

/** Keeps only known keys with boolean values — the safe shape to persist. */
export function sanitizeAdherenceAnswers(input: unknown): AdherenceAnswers {
  const clean: AdherenceAnswers = {};
  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (ADHERENCE_KEYS.has(key) && typeof value === "boolean") clean[key] = value;
    }
  }
  return clean;
}
