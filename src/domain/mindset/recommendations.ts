/**
 * Mindset ← Edge Review: personalized session recommendations (pure).
 *
 * A transparent, rule-based mapping — no AI. Input is the evidence from the
 * trader's FINALIZED Weekly Trade Audits: the tags they themselves recorded
 * (underlying weaknesses, why a trade was invalid, execution issues, why a
 * valid setup was missed). Each tag maps to a behavioural pattern, each
 * pattern to mantra categories.
 *
 * A pattern is only recommended when it RECURS: at least
 * `MIN_OCCURRENCES` tags across at least `MIN_REVIEWS` different reviews,
 * within the most recent `LOOKBACK_REVIEWS` finalized reviews. One isolated
 * mistake never produces a recommendation, and with too little review
 * history the normal Mindset experience is shown.
 *
 * Extensible: add a pattern + its tags here; nothing else changes.
 */

export const LOOKBACK_REVIEWS = 6;
export const MIN_REVIEWS = 2;
export const MIN_OCCURRENCES = 3;

export type PatternId = "PATIENCE" | "CONFIRMATION" | "EMOTIONAL_CONTROL" | "RISK" | "DISCIPLINE" | "TRUST_PROCESS";

export interface PatternDefinition {
  id: PatternId;
  /** Shown in "Your recent reviews identified ___ as an area for improvement." */
  areaLabel: string;
  sessionTitle: string;
  categories: string[];
  /** Default-mantra keys that speak most directly to this pattern (shown first). */
  focusKeys: string[];
  /** Used only when the trader has no enabled mantras in these categories —
   *  shown for that session, never saved to their library. */
  fallbackMantras: string[];
  durationSeconds: number;
  /** Audit tags (namespaced) that evidence this pattern. */
  tags: string[];
}

export const PATTERNS: readonly PatternDefinition[] = [
  {
    id: "PATIENCE",
    areaLabel: "patience",
    sessionTitle: "Patience & Discipline",
    categories: ["Patience", "Discipline"],
    focusKeys: ["patience.no-chasing", "patience.wait-for-setup", "patience.part-of-execution", "patience.missing-better"],
    fallbackMantras: ["I do not chase the market.", "I wait for my setup.", "Patience is part of execution.", "Missing a trade is better than forcing one."],
    durationSeconds: 300,
    tags: ["weakness:IMPATIENCE", "weakness:FOMO", "invalid:OVERTRADING"],
  },
  {
    id: "CONFIRMATION",
    areaLabel: "waiting for confirmation",
    sessionTitle: "Waiting for Confirmation",
    categories: ["Discipline", "Patience"],
    focusKeys: ["discipline.wait-confirmation", "discipline.anticipation", "discipline.criteria-met"],
    fallbackMantras: ["I wait for confirmation.", "Anticipation is not confirmation.", "I only enter when my criteria are satisfied."],
    durationSeconds: 300,
    tags: ["invalid:EARLY_ENTRY", "issue:NO_CONFIRMATION", "issue:ENTRY_TIMING"],
  },
  {
    id: "EMOTIONAL_CONTROL",
    areaLabel: "emotional control after losses",
    sessionTitle: "Emotional Control",
    categories: ["Emotional Control"],
    focusKeys: ["emotion.no-recovery-trades", "emotion.independent-trades", "emotion.not-today", "emotion.objective"],
    fallbackMantras: ["I do not trade to recover losses.", "Every trade is independent.", "I do not need to make money back today.", "I remain objective after every outcome."],
    durationSeconds: 300,
    tags: ["weakness:REVENGE_EMOTION", "invalid:REVENGE"],
  },
  {
    id: "RISK",
    areaLabel: "risk management",
    sessionTitle: "Respecting Risk",
    categories: ["Risk Management"],
    focusKeys: ["risk.defined-before-entry", "risk.never-compromise", "risk.protect-capital"],
    fallbackMantras: ["My risk is defined before entry.", "I never compromise my risk limits.", "Protecting capital is part of my responsibility."],
    durationSeconds: 300,
    tags: ["weakness:RISK_MANAGEMENT", "invalid:RISK_VIOLATION", "issue:STOP_PLACEMENT"],
  },
  {
    id: "DISCIPLINE",
    areaLabel: "following your plan",
    sessionTitle: "Following the Plan",
    categories: ["Discipline"],
    focusKeys: ["discipline.follow-plan", "discipline.respect-rules", "discipline.no-boredom"],
    fallbackMantras: ["I follow my trading plan regardless of how I feel.", "I respect my trading rules.", "I do not make decisions out of boredom."],
    durationSeconds: 300,
    tags: ["weakness:LACK_OF_DISCIPLINE", "invalid:NO_VALID_SETUP", "invalid:OUTSIDE_CONDITIONS"],
  },
  {
    id: "TRUST_PROCESS",
    areaLabel: "trusting your process",
    sessionTitle: "Trusting the Process",
    categories: ["Self-confidence", "Emotional Control"],
    focusKeys: ["confidence.trust-process", "confidence.let-it-work", "confidence.judge-execution"],
    fallbackMantras: ["I trust the process I have developed and tested.", "Once my plan is in place, I let it work.", "I judge myself by execution, not individual outcomes."],
    durationSeconds: 300,
    tags: ["issue:PREMATURE_EXIT", "issue:INTERFERENCE", "weakness:FEAR_HESITATION", "miss:FEAR", "miss:HESITATION"],
  },
];

const PATTERN_BY_TAG = new Map<string, PatternDefinition>(PATTERNS.flatMap((p) => p.tags.map((t) => [t, p] as const)));

/** The tag labels shown in the explanation ("early entries, impatience"). */
const TAG_LABEL: Record<string, string> = {
  "weakness:IMPATIENCE": "impatience",
  "weakness:FOMO": "FOMO",
  "invalid:OVERTRADING": "overtrading",
  "invalid:EARLY_ENTRY": "entries before confirmation",
  "issue:NO_CONFIRMATION": "not waiting for confirmation",
  "issue:ENTRY_TIMING": "entry timing",
  "weakness:REVENGE_EMOTION": "revenge / frustration",
  "invalid:REVENGE": "revenge trades",
  "weakness:RISK_MANAGEMENT": "risk management",
  "invalid:RISK_VIOLATION": "broken risk limits",
  "issue:STOP_PLACEMENT": "stop placement",
  "weakness:LACK_OF_DISCIPLINE": "lack of discipline",
  "invalid:NO_VALID_SETUP": "trades without a valid setup",
  "invalid:OUTSIDE_CONDITIONS": "trades outside your conditions",
  "issue:PREMATURE_EXIT": "early exits",
  "issue:INTERFERENCE": "interfering with valid positions",
  "weakness:FEAR_HESITATION": "fear / hesitation",
  "miss:FEAR": "setups missed out of fear",
  "miss:HESITATION": "setups missed through hesitation",
};

/** One finalized review's evidence: its id, week, and the tags recorded in it. */
export interface ReviewEvidence {
  auditId: string;
  weekStart: string;
  tags: string[];
}

export interface MindsetRecommendation {
  /** Stable identity of THIS recommendation on THIS evidence (dismissal key). */
  key: string;
  pattern: PatternId;
  title: string;
  areaLabel: string;
  reason: string;
  categories: string[];
  focusKeys: string[];
  fallbackMantras: string[];
  durationSeconds: number;
  occurrences: number;
  reviewCount: number;
  reviewsConsidered: number;
}

/**
 * Ranked recommendations from recurring patterns (strongest first). Empty when
 * there is too little history or nothing recurs.
 */
export function recommendFromReviews(reviews: ReviewEvidence[]): MindsetRecommendation[] {
  const recent = [...reviews].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, LOOKBACK_REVIEWS);
  if (recent.length < MIN_REVIEWS) return [];

  const stats = new Map<PatternId, { occurrences: number; reviews: Set<string>; tagCounts: Map<string, number> }>();
  for (const review of recent) {
    for (const tag of review.tags) {
      const pattern = PATTERN_BY_TAG.get(tag);
      if (!pattern) continue;
      const s = stats.get(pattern.id) ?? { occurrences: 0, reviews: new Set<string>(), tagCounts: new Map<string, number>() };
      s.occurrences += 1;
      s.reviews.add(review.auditId);
      s.tagCounts.set(tag, (s.tagCounts.get(tag) ?? 0) + 1);
      stats.set(pattern.id, s);
    }
  }

  const latestId = recent[0].auditId;
  return PATTERNS.flatMap((p) => {
    const s = stats.get(p.id);
    if (!s || s.reviews.size < MIN_REVIEWS || s.occurrences < MIN_OCCURRENCES) return [];
    const topTags = [...s.tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => TAG_LABEL[t] ?? t);
    return [
      {
        key: `${p.id}:${latestId}`,
        pattern: p.id,
        title: p.sessionTitle,
        areaLabel: p.areaLabel,
        reason: `Recorded ${s.occurrences} times across ${s.reviews.size} of your last ${recent.length} finalized reviews (${topTags.join(", ")}).`,
        categories: p.categories,
        focusKeys: p.focusKeys,
        fallbackMantras: p.fallbackMantras,
        durationSeconds: p.durationSeconds,
        occurrences: s.occurrences,
        reviewCount: s.reviews.size,
        reviewsConsidered: recent.length,
      },
    ];
  }).sort((a, b) => b.reviewCount - a.reviewCount || b.occurrences - a.occurrences);
}

/** Mantras for a recommended session from the trader's OWN enabled library:
 *  pattern-focus defaults first, then the rest of those categories. */
export function mantrasForRecommendation<T extends { id: string; category: string; defaultKey: string | null; enabled: boolean }>(
  rec: Pick<MindsetRecommendation, "categories" | "focusKeys">,
  library: T[],
): T[] {
  const inScope = library.filter((m) => m.enabled && rec.categories.includes(m.category));
  const rank = (m: T) => (m.defaultKey && rec.focusKeys.includes(m.defaultKey) ? rec.focusKeys.indexOf(m.defaultKey) : rec.focusKeys.length + rec.categories.indexOf(m.category));
  return [...inScope].sort((a, b) => rank(a) - rank(b));
}
