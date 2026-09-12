// Pre-Trade Mood Snapshot (Stage 5) — the closed tag vocabulary shared by the
// zod schema, the UI, and anywhere later analytics reads Trade.preTradeMoodTags.
// Deliberately separate from domain/psychology/questions.ts's deep, scored
// Post-Trade Honest Questionnaire — this is a fast, unscored, moment-in-time
// check-in with no right answer.

export const PRE_TRADE_MOOD_TAGS = [
  "CALM",
  "FOCUSED",
  "CONFIDENT",
  "PATIENT",
  "HESITANT",
  "FEARFUL",
  "IMPATIENT",
  "EXCITED",
  "FOMO",
  "FRUSTRATED",
  "REVENGE_MINDED",
] as const;

export type PreTradeMoodTagValue = (typeof PRE_TRADE_MOOD_TAGS)[number];

export const PRE_TRADE_MOOD_TAG_LABELS: Record<PreTradeMoodTagValue, string> = {
  CALM: "Calm",
  FOCUSED: "Focused",
  CONFIDENT: "Confident",
  PATIENT: "Patient",
  HESITANT: "Hesitant",
  FEARFUL: "Fearful",
  IMPATIENT: "Impatient",
  EXCITED: "Excited",
  FOMO: "FOMO",
  FRUSTRATED: "Frustrated",
  REVENGE_MINDED: "Revenge-minded",
};

export const PRE_TRADE_MOOD_MIN_INTENSITY = 1;
export const PRE_TRADE_MOOD_MAX_INTENSITY = 5;
