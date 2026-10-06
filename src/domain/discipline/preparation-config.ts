/**
 * Preparation Score — scoring configuration (Phase 1, pure).
 *
 * Everything that decides a score is DATA, frozen per schedule version
 * (`scoringVersion` + the bands/cutoff below), so a later change to the
 * scoring rules never rewrites a historical day.
 *
 * Score = Completion (0–70) + Timing (0–30). No PnL, no trade count, no
 * win/loss — a correctly flat day can score 100.
 */

export type PreparationStatus =
  | "VERY_EARLY"
  | "EARLY"
  | "ON_TIME"
  | "LATE"
  | "VERY_LATE"
  | "INCOMPLETE"
  | "MISSED"
  | "DAY_OFF"
  | "NOT_SCHEDULED";

/** Statuses that extend the Preparation Streak. */
export const STREAK_COUNTED: ReadonlySet<PreparationStatus> = new Set(["VERY_EARLY", "EARLY", "ON_TIME", "LATE", "VERY_LATE"]);
/** Statuses that break it. */
export const STREAK_BREAKING: ReadonlySet<PreparationStatus> = new Set(["INCOMPLETE", "MISSED"]);
/** Exempt — neither extend nor break. */
export const STREAK_EXEMPT: ReadonlySet<PreparationStatus> = new Set(["DAY_OFF", "NOT_SCHEDULED"]);

/**
 * One timing band. Bands are evaluated in order on the signed deviation
 * d = readyAt − targetAt (exact milliseconds; negative = early):
 *   upTo = number → the band holds d < upTo·60s (inclusive=false) or d ≤ upTo·60s (inclusive=true)
 *   upTo = null   → the band holds everything up to and including the cutoff.
 * Bands therefore never overlap and every deviation up to the cutoff lands
 * in exactly one band.
 */
export interface TimingBand {
  upToMinutes: number | null;
  inclusive: boolean;
  points: number;
  status: Extract<PreparationStatus, "VERY_EARLY" | "EARLY" | "ON_TIME" | "LATE" | "VERY_LATE">;
  /** Plain-language label shown in the breakdown. */
  label: string;
}

export interface PreparationScoringRules {
  scoringVersion: number;
  completionMax: number;
  timingMax: number;
  /** Cutoff = target + this many minutes of elapsed time … */
  cutoffAfterTargetMinutes: number;
  /** … capped at this local wall-clock minute of the same date (1439 = 23:59). */
  cutoffCapLocalMinutes: number;
  bands: TimingBand[];
}

/**
 * Scoring version 1 (approved):
 *   d < T−3h            15  Very early
 *   T−3h ≤ d < T−60m    25  Early
 *   T−60m ≤ d ≤ T+15m   30  On time
 *   T+15m < d ≤ T+30m   25  Late
 *   T+30m < d ≤ T+60m   18  Late
 *   T+60m < d ≤ T+2h    10  Very late
 *   T+2h < d ≤ cutoff    5  Very late
 *   after cutoff         0  (INCOMPLETE / MISSED)
 * Boundaries are inclusive on the side nearer the target (T−60m and T+15m
 * are on time; T−3h is early; T+30m, T+60m and T+2h belong to the band
 * that ends there).
 */
export const PREPARATION_SCORING_V1: PreparationScoringRules = {
  scoringVersion: 1,
  completionMax: 70,
  timingMax: 30,
  cutoffAfterTargetMinutes: 360,
  cutoffCapLocalMinutes: 1439,
  bands: [
    { upToMinutes: -180, inclusive: false, points: 15, status: "VERY_EARLY", label: "Very early" },
    { upToMinutes: -60, inclusive: false, points: 25, status: "EARLY", label: "Early" },
    { upToMinutes: 15, inclusive: true, points: 30, status: "ON_TIME", label: "On time" },
    { upToMinutes: 30, inclusive: true, points: 25, status: "LATE", label: "Late" },
    { upToMinutes: 60, inclusive: true, points: 18, status: "LATE", label: "Late" },
    { upToMinutes: 120, inclusive: true, points: 10, status: "VERY_LATE", label: "Very late" },
    { upToMinutes: null, inclusive: true, points: 5, status: "VERY_LATE", label: "Very late" },
  ],
};

/** Structural checks for a rules object (used before freezing it into a schedule version). */
export function validateScoringRules(rules: PreparationScoringRules): string[] {
  const errors: string[] = [];
  if (rules.completionMax + rules.timingMax !== 100) errors.push("completion + timing must total 100.");
  if (rules.bands.length === 0) errors.push("at least one timing band is required.");
  if (rules.bands[rules.bands.length - 1]?.upToMinutes !== null) errors.push("the last band must run to the cutoff (upToMinutes null).");
  let prev = -Infinity;
  for (const b of rules.bands.slice(0, -1)) {
    if (b.upToMinutes == null || b.upToMinutes <= prev) errors.push("band limits must strictly increase.");
    prev = b.upToMinutes ?? prev;
  }
  if (rules.bands.some((b) => b.points < 0 || b.points > rules.timingMax)) errors.push("band points must be within 0…timingMax.");
  if (!rules.bands.some((b) => b.status === "ON_TIME" && b.points === rules.timingMax)) errors.push("the on-time band must award full timing points.");
  if (rules.cutoffAfterTargetMinutes <= 0) errors.push("cutoff must be after the target.");
  if (rules.cutoffCapLocalMinutes < 0 || rules.cutoffCapLocalMinutes > 1439) errors.push("cutoff cap must be a local minute 0–1439.");
  return errors;
}
