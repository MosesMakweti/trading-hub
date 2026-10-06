/**
 * Preparation Score for one scheduled day (Phase 1, pure).
 *
 *   Score      = Completion + Timing                     (0–100, integers)
 *   Completion = 70 when readiness was confirmed by the cutoff;
 *                otherwise round(70 × requiredDone / requiredTotal) where
 *                requiredDone counts only items completed by the cutoff
 *                (zero required items and no readiness → 0)
 *   Timing     = the band of d = firstReadyAt − targetAt (exact ms) when
 *                readiness came by the cutoff; else 0
 *
 * Inputs are frozen facts: `firstReadyAt` is the write-once first readiness
 * instant (reopening the routine never changes it), and `requiredItems` is
 * the day's mandatory set frozen when the routine was first created, each
 * with the server instant it was completed (null = not completed).
 * Optional items are never inputs, so they can never lower a score.
 */
import type { PreparationScoringRules, PreparationStatus, TimingBand } from "./preparation-config";
import type { DayInstants } from "./preparation-schedule";

export interface RequiredItemFact {
  id: string;
  /** Server instant the item became complete, or null. */
  completedAt: Date | null;
}

export interface PreparationDayFacts {
  firstReadyAt: Date | null;
  requiredItems: RequiredItemFact[];
}

export interface PreparationScoreBreakdown {
  status: PreparationStatus;
  /** True when the outcome can no longer change (ready by the cutoff, or the cutoff has passed). */
  final: boolean;
  completionPoints: number;
  timingPoints: number;
  score: number;
  requiredTotal: number;
  requiredDone: number;
  targetAt: Date;
  cutoffAt: Date;
  readyAt: Date | null;
  /** readyAt − targetAt in ms (null when not ready by the cutoff). */
  deviationMs: number | null;
  /** Rounded minutes for display ("17 min late"); negative = early. */
  deviationMinutes: number | null;
  bandLabel: string | null;
  scoringVersion: number;
}

export type PendingPreparation = {
  status: "PENDING";
  final: false;
  requiredTotal: number;
  requiredDone: number;
  targetAt: Date;
  cutoffAt: Date;
  /** Minutes until the target (negative once past it). */
  minutesToTarget: number;
};

/** The timing band for a deviation within [−∞, cutoff]. */
export function timingBandFor(rules: PreparationScoringRules, deviationMs: number): TimingBand {
  for (const band of rules.bands) {
    if (band.upToMinutes == null) return band;
    const limit = band.upToMinutes * 60_000;
    if (band.inclusive ? deviationMs <= limit : deviationMs < limit) return band;
  }
  return rules.bands[rules.bands.length - 1];
}

/** Display rounding: whole minutes, half away from zero. */
function roundMinutes(ms: number): number {
  const m = ms / 60_000;
  return m < 0 ? -Math.round(-m) : Math.round(m);
}

/**
 * Scores one SCHEDULED day at instant `now` (server clock). Returns PENDING
 * while readiness has not happened and the cutoff has not passed — a pending
 * day is never a miss.
 */
export function scorePreparationDay(
  rules: PreparationScoringRules,
  instants: DayInstants,
  facts: PreparationDayFacts,
  now: Date,
): PreparationScoreBreakdown | PendingPreparation {
  const { targetAt, cutoffAt } = instants;
  const requiredTotal = facts.requiredItems.length;
  const doneBy = (at: Date) => facts.requiredItems.filter((i) => i.completedAt != null && i.completedAt.getTime() <= at.getTime()).length;

  const ready = facts.firstReadyAt;
  if (ready && ready.getTime() <= cutoffAt.getTime()) {
    const deviationMs = ready.getTime() - targetAt.getTime();
    const band = timingBandFor(rules, deviationMs);
    return {
      status: band.status,
      final: true,
      completionPoints: rules.completionMax,
      timingPoints: band.points,
      score: rules.completionMax + band.points,
      requiredTotal,
      requiredDone: requiredTotal, // readiness is impossible without every required item
      targetAt,
      cutoffAt,
      readyAt: ready,
      deviationMs,
      deviationMinutes: roundMinutes(deviationMs),
      bandLabel: band.label,
      scoringVersion: rules.scoringVersion,
    };
  }

  if (now.getTime() <= cutoffAt.getTime()) {
    return {
      status: "PENDING",
      final: false,
      requiredTotal,
      requiredDone: doneBy(now),
      targetAt,
      cutoffAt,
      minutesToTarget: Math.ceil((targetAt.getTime() - now.getTime()) / 60_000),
    };
  }

  // Cutoff passed without readiness: finalized. Late completion can never restore it.
  const requiredDone = doneBy(cutoffAt);
  const completionPoints = requiredTotal === 0 ? 0 : Math.round((rules.completionMax * requiredDone) / requiredTotal);
  return {
    status: requiredDone > 0 ? "INCOMPLETE" : "MISSED",
    final: true,
    completionPoints,
    timingPoints: 0,
    score: completionPoints,
    requiredTotal,
    requiredDone,
    targetAt,
    cutoffAt,
    readyAt: null,
    deviationMs: null,
    deviationMinutes: null,
    bandLabel: null,
    scoringVersion: rules.scoringVersion,
  };
}
