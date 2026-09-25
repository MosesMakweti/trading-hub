/**
 * Read-only historical re-fill chunking (Stage 17B §23-24, corrected Prompt
 * 5 §8/§26 — strict no-future-candle delivery) — decides the next
 * day-aligned chunk of ALREADY-AUTHORIZED candles Replay should request via
 * the read-only `getReplayCandles` action. Every request this drives is
 * bounded to at most `MAX_CHUNK_DAYS` days, purely for response-size/vendor
 * rate-limit reasons (Stage 17A/§25) — never for visibility. Visibility is
 * enforced entirely server-side now (`replay-review.service.ts`'s
 * `fetchReplayCandlesWithProvenance`, which clips every response to the
 * session's own authoritative `replayCurrentTime` regardless of what range
 * is requested here).
 *
 * Prompt 5 REMOVED this module's old `PREFETCH_DAYS_AHEAD`/
 * `computeNextFetchWindow`/`computeNextBackgroundChunk` — their entire
 * purpose was requesting candles AHEAD of the Replay Clock "so playback
 * feels smoother later." That is precisely the mechanism that put future
 * OHLC in browser memory before this hardening pass (see that pass's own
 * completion report, §A "Previous Leakage Path"). Forward REVEALING
 * (Step/Play/seek/jump-to-start/day-nav) no longer uses this module at
 * all — it goes through `advanceReplayClockAction`
 * (`replay-review.service.ts`'s `advanceReplayClock`), which the client
 * calls directly with a target instant the server independently clamps.
 * This module is left with exactly one job: efficiently re-fetching
 * history the session has ALREADY legitimately revealed (e.g. rebuilding
 * client state after a page reload, §23) — bounded to the client's own
 * current clock position, never further, so a stale/idle tab never
 * wastefully asks for a whole review period's worth of empty responses.
 */
const DAY_MS = 86_400_000;

export interface LoadedRange {
  from: number;
  to: number;
}

/** Cap on any single request's span — keeps every request small regardless
 *  of caller, satisfying §23's "never a whole multi-week response" goal. */
export const MAX_CHUNK_DAYS = 7;

function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Is `[from, to]` (the FULL span actually being asked about — which may be
 *  a partial day when `to` isn't day-aligned, e.g. `computeNextHistoryChunk`
 *  bounding to a mid-day clock position) already covered by `loaded`? This
 *  is deliberately NOT "is the whole calendar day covered" — requiring
 *  full-day coverage for a span that can never reach a full day (because
 *  `to` itself lands before the day's end) would never be satisfied,
 *  looping forever. */
function isRangeCovered(loaded: LoadedRange[], from: number, to: number): boolean {
  return loaded.some((r) => r.from <= from && r.to >= to);
}

/** The first uncovered day-aligned chunk within `[from, to]`, batching up to
 *  `maxDays` contiguous uncovered days into one range. Null when fully covered. */
export function findNextUncoveredChunk(loaded: LoadedRange[], from: number, to: number, maxDays: number = MAX_CHUNK_DAYS): LoadedRange | null {
  if (from > to) return null;
  for (let day = dayStart(from); day <= to; day += DAY_MS) {
    const dayEnd = Math.min(day + DAY_MS - 1, to);
    if (isRangeCovered(loaded, day, dayEnd)) continue;
    let rangeEnd = dayEnd;
    let count = 1;
    let next = day + DAY_MS;
    while (next <= to && count < maxDays) {
      const nextDayEnd = Math.min(next + DAY_MS - 1, to);
      if (isRangeCovered(loaded, next, nextDayEnd)) break;
      rangeEnd = nextDayEnd;
      next += DAY_MS;
      count += 1;
    }
    return { from: day, to: rangeEnd };
  }
  return null;
}

/**
 * The next chunk of ALREADY-AUTHORIZED history to pull via the read-only
 * `getReplayCandles`, sweeping `[periodStart, min(periodEnd, clockTime)]`
 * in bounded chunks — deliberately bounded to the caller's OWN current
 * clock position (never `periodEnd` directly), so this never wastefully
 * requests candles the session hasn't reached yet even though doing so
 * would be harmless (the server would just return nothing past its own
 * boundary — §7). Returns null once that bounded range is fully covered.
 */
export function computeNextHistoryChunk(loaded: LoadedRange[], clockTime: number, periodStart: number, periodEnd: number): LoadedRange | null {
  const boundedTo = Math.min(clockTime, periodEnd);
  return findNextUncoveredChunk(loaded, periodStart, boundedTo, MAX_CHUNK_DAYS);
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
