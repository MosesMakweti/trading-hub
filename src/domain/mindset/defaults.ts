/**
 * Mindset — the default mantra collection (pure, client-safe).
 *
 * Seeded once per trader (see mindset.service `ensureMindsetDefaults`); every
 * entry has a stable `key` so seeding is idempotent and a mantra the trader
 * deleted is never put back. These reinforce behaviours — they make no promise
 * of profitability.
 */

export const DEFAULT_CATEGORIES = ["Discipline", "Patience", "Emotional Control", "Risk Management", "Self-confidence"] as const;

export interface DefaultMantra {
  key: string;
  category: (typeof DEFAULT_CATEGORIES)[number];
  text: string;
}

export const DEFAULT_MANTRAS: readonly DefaultMantra[] = [
  // Discipline
  { key: "discipline.follow-plan", category: "Discipline", text: "I follow my trading plan regardless of how I feel." },
  { key: "discipline.no-boredom", category: "Discipline", text: "I do not make decisions out of boredom." },
  { key: "discipline.wait-confirmation", category: "Discipline", text: "I wait for confirmation before entering." },
  { key: "discipline.respect-rules", category: "Discipline", text: "I respect my trading rules." },
  { key: "discipline.anticipation", category: "Discipline", text: "Anticipation is not confirmation." },
  { key: "discipline.criteria-met", category: "Discipline", text: "I only enter when my criteria are satisfied." },
  // Patience
  { key: "patience.no-chasing", category: "Patience", text: "I do not chase the market." },
  { key: "patience.another-opportunity", category: "Patience", text: "There is always another opportunity." },
  { key: "patience.not-every-day", category: "Patience", text: "I do not need to trade every day." },
  { key: "patience.waiting-is-decision", category: "Patience", text: "Waiting is also a trading decision." },
  { key: "patience.wait-for-setup", category: "Patience", text: "I do not chase opportunities. I wait for my setup." },
  { key: "patience.missing-better", category: "Patience", text: "Missing a trade is better than forcing one." },
  { key: "patience.part-of-execution", category: "Patience", text: "Patience is part of execution." },
  { key: "patience.market-owes-nothing", category: "Patience", text: "The market owes me nothing." },
  // Emotional control
  { key: "emotion.no-recovery-trades", category: "Emotional Control", text: "I do not trade to recover losses." },
  { key: "emotion.calm-after-outcomes", category: "Emotional Control", text: "I remain calm after winning and losing." },
  { key: "emotion.not-my-entries", category: "Emotional Control", text: "My emotions do not determine my entries." },
  { key: "emotion.accept-uncertainty", category: "Emotional Control", text: "I accept uncertainty." },
  { key: "emotion.independent-trades", category: "Emotional Control", text: "Every trade is independent." },
  { key: "emotion.not-today", category: "Emotional Control", text: "I do not need to make money back today." },
  { key: "emotion.objective", category: "Emotional Control", text: "I remain objective after every outcome." },
  { key: "emotion.accept-losses", category: "Emotional Control", text: "I accept losses without abandoning my strategy." },
  // Risk management
  { key: "risk.protect-capital", category: "Risk Management", text: "Protecting my capital is my responsibility." },
  { key: "risk.know-before-entry", category: "Risk Management", text: "I know my risk before entering." },
  { key: "risk.no-single-trade", category: "Risk Management", text: "No single trade is worth compromising my system." },
  { key: "risk.no-frustration-size", category: "Risk Management", text: "I never increase risk out of frustration." },
  { key: "risk.defined-before-entry", category: "Risk Management", text: "My risk is defined before I enter a trade." },
  { key: "risk.never-compromise", category: "Risk Management", text: "I never compromise my risk limits." },
  // Self-confidence
  { key: "confidence.trust-process", category: "Self-confidence", text: "I trust the process I have developed and tested." },
  { key: "confidence.no-validation", category: "Self-confidence", text: "I do not need external validation for my decisions." },
  { key: "confidence.judge-execution", category: "Self-confidence", text: "I judge myself by execution, not individual outcomes." },
  { key: "confidence.let-it-work", category: "Self-confidence", text: "Once my plan is in place, I let it work." },
];
