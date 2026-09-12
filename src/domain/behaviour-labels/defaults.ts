// Trade Review overhaul (Stage 7 §8) — the starter Behaviour Label catalog,
// seeded per-user on first use (see behaviour-labels.service.ts). Deliberately
// NOT strategy-specific — these describe trader conduct across the whole
// system. A trader may rename, recolor, or archive any of these exactly like
// a custom label (isDefault is informational only).

export interface DefaultBehaviourLabel {
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
}

export const DEFAULT_BEHAVIOUR_LABELS: DefaultBehaviourLabel[] = [
  // Positive
  { name: "Followed trading plan", polarity: "POSITIVE" },
  { name: "Waited for confirmation", polarity: "POSITIVE" },
  { name: "Correct risk", polarity: "POSITIVE" },
  { name: "Respected SL", polarity: "POSITIVE" },
  { name: "Setup part of plan", polarity: "POSITIVE" },
  { name: "Patient execution", polarity: "POSITIVE" },
  { name: "Took planned partial", polarity: "POSITIVE" },
  { name: "Let winner run", polarity: "POSITIVE" },
  { name: "Accepted loss", polarity: "POSITIVE" },
  { name: "Managed risk correctly", polarity: "POSITIVE" },
  { name: "Followed news restriction", polarity: "POSITIVE" },
  { name: "Maintained emotional control", polarity: "POSITIVE" },
  // Negative
  { name: "FOMO trade", polarity: "NEGATIVE" },
  { name: "Revenge trade", polarity: "NEGATIVE" },
  { name: "Overtraded", polarity: "NEGATIVE" },
  { name: "Over-risked", polarity: "NEGATIVE" },
  { name: "Entered early", polarity: "NEGATIVE" },
  { name: "Entered late", polarity: "NEGATIVE" },
  { name: "No confirmation", polarity: "NEGATIVE" },
  { name: "Invalid setup", polarity: "NEGATIVE" },
  { name: "Chased price", polarity: "NEGATIVE" },
  { name: "Moved SL wider", polarity: "NEGATIVE" },
  { name: "Closed winner early", polarity: "NEGATIVE" },
  { name: "Failed planned partial", polarity: "NEGATIVE" },
  { name: "Took profit too early", polarity: "NEGATIVE" },
  { name: "Held beyond plan", polarity: "NEGATIVE" },
  { name: "Ignored news", polarity: "NEGATIVE" },
  { name: "Ignored daily bias", polarity: "NEGATIVE" },
  { name: "Hesitated on valid setup", polarity: "NEGATIVE" },
  { name: "Missed valid trade", polarity: "NEGATIVE" },
  { name: "Emotional execution", polarity: "NEGATIVE" },
  { name: "Broke daily risk limit", polarity: "NEGATIVE" },
  { name: "Unplanned trade", polarity: "NEGATIVE" },
];
