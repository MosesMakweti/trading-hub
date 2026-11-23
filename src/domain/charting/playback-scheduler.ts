/**
 * Playback scheduling (pure). Bar k (0-based) is due at start + k·interval —
 * a fixed timeline, so processing time never accumulates as drift. The player
 * asks for every bar that is due in one request (never overlapping requests;
 * the server settles each bar in order, so nothing is skipped). If it falls
 * more than `maxBatch` bars behind, the backlog is dropped by re-anchoring:
 * playback runs slower than asked instead of jumping ahead.
 */
export interface PlaybackClock {
  start: number; // ms timestamp of bar 0
  done: number; // bars already requested
  intervalMs: number;
}

export type PlaybackPlan = { kind: "wait"; ms: number } | { kind: "step"; count: number; clock: PlaybackClock };

export function startPlayback(now: number, intervalMs: number): PlaybackClock {
  return { start: now, done: 0, intervalMs };
}

/** Change speed mid-playback: the next bar comes one new interval from now. */
export function changeSpeed(c: PlaybackClock, now: number, intervalMs: number): PlaybackClock {
  return { start: now - (c.done - 1) * intervalMs, done: c.done, intervalMs };
}

export function planPlayback(c: PlaybackClock, now: number, maxBatch = 120): PlaybackPlan {
  const due = Math.floor((now - c.start) / c.intervalMs) + 1 - c.done;
  if (due < 1) return { kind: "wait", ms: c.start + c.done * c.intervalMs - now };
  const count = Math.min(due, maxBatch);
  const behind = due > maxBatch;
  const done = c.done + count;
  // Too far behind: re-anchor so the next bar is due one interval from now.
  const start = behind ? now - (done - 1) * c.intervalMs : c.start;
  return { kind: "step", count, clock: { start, done, intervalMs: c.intervalMs } };
}
