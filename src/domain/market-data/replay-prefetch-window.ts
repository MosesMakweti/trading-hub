/**
 * Replay candle chunking/prefetch (Stage 17B §23-24) — decides the next
 * day-aligned chunk of candles Replay should REQUEST, given what's already
 * loaded and where the Replay Clock currently sits. This deliberately
 * replaces the old "fetch the whole review period in one response" pattern
 * (fine for a synthetic Fixture, unworkable against a real vendor's rate
 * limits/payload size and Vercel's request-size limits — Stage 17A/§25):
 * every request this drives is bounded to at most `MAX_CHUNK_DAYS` days.
 *
 * Two callers use this, both in `replay-market-panel.tsx`:
 *  - `computeNextFetchWindow` — HIGH PRIORITY: a small rolling window around
 *    the Clock's current position, so the trader's immediate viewport and
 *    near-future stepping/playing rarely block on network.
 *  - `computeNextBackgroundChunk` — LOW PRIORITY: once the rolling window is
 *    satisfied, keep sweeping the REST of the review period in small
 *    chunks in the background, so day-navigation (`shiftDay`) and
 *    jump-to-start across the whole period keep working exactly as before
 *    this refactor — just assembled from many small requests instead of one
 *    giant one.
 *
 * This module decides WHAT TO FETCH ONLY. Chart visibility stays governed
 * exclusively by the Replay Clock via `visible-candles.ts` — "prefetched !=
 * visible" is unchanged by this refactor.
 */
const DAY_MS = 86_400_000;

export interface LoadedRange {
  from: number;
  to: number;
}

/** How far behind/ahead of the clock's current position to keep candles
 *  loaded via the HIGH-priority window. Asymmetric on purpose: playing
 *  forward continuously is the common case; stepping back one day is rare. */
export const PREFETCH_DAYS_BEHIND = 1;
export const PREFETCH_DAYS_AHEAD = 3;

/** Cap on any single request's span — keeps every request small regardless
 *  of caller, satisfying §23's "never a whole multi-week response" goal
 *  even for the background sweep. */
export const MAX_CHUNK_DAYS = 7;

function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function isDayCovered(loaded: LoadedRange[], day: number): boolean {
  const dayEnd = day + DAY_MS - 1;
  return loaded.some((r) => r.from <= day && r.to >= dayEnd);
}

/** The first uncovered day-aligned chunk within `[from, to]`, batching up to
 *  `maxDays` contiguous uncovered days into one range. Null when fully covered. */
export function findNextUncoveredChunk(loaded: LoadedRange[], from: number, to: number, maxDays: number = MAX_CHUNK_DAYS): LoadedRange | null {
  if (from > to) return null;
  for (let day = dayStart(from); day <= to; day += DAY_MS) {
    if (isDayCovered(loaded, day)) continue;
    let rangeEnd = Math.min(day + DAY_MS - 1, to);
    let count = 1;
    let next = day + DAY_MS;
    while (next <= to && count < maxDays && !isDayCovered(loaded, next)) {
      rangeEnd = Math.min(next + DAY_MS - 1, to);
      next += DAY_MS;
      count += 1;
    }
    return { from: day, to: rangeEnd };
  }
  return null;
}

/**
 * HIGH-priority: the next chunk needed to keep a small rolling window
 * around `clockTime` fully loaded. Returns null once that window (clamped
 * to the review period) is fully covered.
 */
export function computeNextFetchWindow(loaded: LoadedRange[], clockTime: number, periodStart: number, periodEnd: number): LoadedRange | null {
  const wantFrom = Math.max(periodStart, dayStart(clockTime) - PREFETCH_DAYS_BEHIND * DAY_MS);
  const wantTo = Math.min(periodEnd, dayStart(clockTime) + (PREFETCH_DAYS_AHEAD + 1) * DAY_MS - 1);
  return findNextUncoveredChunk(loaded, wantFrom, wantTo, Number.MAX_SAFE_INTEGER);
}

/**
 * LOW-priority background sweep: once the rolling window is satisfied, keep
 * filling in the rest of `[periodStart, periodEnd]` in small
 * (`MAX_CHUNK_DAYS`-bounded) chunks so whole-period features (day
 * navigation, jump-to-start) still work once the sweep finishes.
 */
export function computeNextBackgroundChunk(loaded: LoadedRange[], periodStart: number, periodEnd: number): LoadedRange | null {
  return findNextUncoveredChunk(loaded, periodStart, periodEnd, MAX_CHUNK_DAYS);
}

/** Merges a newly-fetched range into the loaded-ranges list, coalescing
 *  adjacent/overlapping ranges so the list never grows unbounded. */
export function mergeLoadedRange(loaded: LoadedRange[], next: LoadedRange): LoadedRange[] {
  const all = [...loaded, next].sort((a, b) => a.from - b.from);
  const merged: LoadedRange[] = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 1) {
      last.to = Math.max(last.to, r.to);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}
