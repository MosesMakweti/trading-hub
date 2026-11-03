/**
 * Streak milestones (pure). The same ladder for all three tracks: days of
 * routine, consecutive review days, consecutive plan-adherent trading days.
 */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 60, 90];

export interface MilestoneProgress {
  /** The milestone being worked towards; null once every milestone is behind. */
  target: number | null;
  /** The last milestone already passed (0 = none yet). */
  previous: number;
  remaining: number;
  /** 0–1 progress from `previous` to `target` (1 when all reached). */
  fraction: number;
}

export function milestoneProgress(current: number): MilestoneProgress {
  const target = STREAK_MILESTONES.find((m) => m > current) ?? null;
  const previous = [...STREAK_MILESTONES].reverse().find((m) => m <= current) ?? 0;
  if (target == null) return { target: null, previous, remaining: 0, fraction: 1 };
  return { target, previous, remaining: target - current, fraction: (current - previous) / (target - previous) };
}

/** The milestone exactly hit by `current`, if any (for the "milestone reached" moment). */
export function milestoneAt(current: number): number | null {
  return STREAK_MILESTONES.includes(current) ? current : null;
}
