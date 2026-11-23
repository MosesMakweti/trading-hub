/**
 * Playback pacing (pure): when to show the next playback step on the chart.
 *
 * Steps come from the server slightly ahead of time; the pacer shows them one
 * at a time, `intervalMs` apart:
 *  - the next step is due one CURRENT interval after the last one shown, so a
 *    speed change applies at once (no restart, no wait at the old speed);
 *  - while waiting on the server nothing accumulates: when steps arrive the
 *    first shows at once and the rest follow at the normal pace (no burst);
 *  - if the device falls far behind, playback slows down instead of jumping.
 */
export interface Pacer {
  /** When the last step was shown (ms), or null before the first. */
  last: number | null;
  /** Ran dry since (waited on the server): the next step starts a fresh timeline. */
  idle?: boolean;
}

export type PaceDecision = { kind: "wait"; ms: number } | { kind: "show"; pacer: Pacer };

export const startPacer = (): Pacer => ({ last: null });

/** A step is ready: show it now, or wait. */
export function pace(p: Pacer, now: number, intervalMs: number, maxLagMs = 250): PaceDecision {
  const due = p.last == null ? now : p.last + intervalMs;
  if (now < due) return { kind: "wait", ms: due - now };
  // Keep the timeline (no drift) unless it ran dry or is hopelessly behind.
  return { kind: "show", pacer: { last: p.idle || now - due > maxLagMs ? now : due } };
}

/** Nothing to show (waiting on the server): don't let time owed pile up. */
export function paceIdle(p: Pacer, now: number, intervalMs: number): Pacer {
  return p.last == null ? p : { last: Math.max(p.last, now - intervalMs), idle: true };
}
