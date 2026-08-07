// Pure weighted confluence "setup score" engine. Given a strategy's EXPECTED
// confluences (each with a probability weight + whether it's a mandatory core
// requirement) and the confluences the trader confirmed present, it produces the
// setup's validity, weighted probability score, and A+/A/B/C/Low rating.
//
// This is a discipline / setup-quality measure, NOT a market-direction prediction.
// Mandatory confluences GATE validity (a setup missing any is "Invalid"); optional
// confluences only add to the weighted score.

export interface SetupConfluence {
  name: string;
  weight: number | null; // 0–100; null counts as 0 toward the weighted score
  mandatory: boolean;
}

export type SetupRating = "A+" | "A" | "B" | "C" | "LOW";

export interface SetupScore {
  setupValid: boolean; // false when a mandatory confluence is missing
  totalWeight: number; // sum of expected confluence weights
  completedWeight: number; // sum of weights of confluences present
  setupScore: number | null; // completedWeight / totalWeight × 100 (rounded); null if totalWeight is 0
  setupRating: SetupRating | null; // band of setupScore; null when score is null
  missingConfluences: string[]; // expected confluences not present (original names)
  missingMandatory: string[]; // the subset of missing confluences that are mandatory
}

/** A+ 95–100 · A 85–94 · B 75–84 · C 65–74 · Low < 65. */
export function ratingForScore(score: number): SetupRating {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  return "LOW";
}

export function scoreSetup(expected: SetupConfluence[], selectedNames: string[]): SetupScore {
  const selected = new Set(selectedNames.map((n) => n.trim().toLowerCase()));
  const isPresent = (c: SetupConfluence) => selected.has(c.name.trim().toLowerCase());

  let totalWeight = 0;
  let completedWeight = 0;
  const missingConfluences: string[] = [];
  const missingMandatory: string[] = [];

  for (const c of expected) {
    const weight = c.weight ?? 0;
    totalWeight += weight;
    if (isPresent(c)) {
      completedWeight += weight;
    } else {
      missingConfluences.push(c.name);
      if (c.mandatory) missingMandatory.push(c.name);
    }
  }

  const setupValid = missingMandatory.length === 0;
  const setupScore = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : null;
  const setupRating = setupScore == null ? null : ratingForScore(setupScore);

  return {
    setupValid,
    totalWeight,
    completedWeight,
    setupScore,
    setupRating,
    missingConfluences,
    missingMandatory,
  };
}
