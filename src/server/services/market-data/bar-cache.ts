/**
 * Server-side private buffer of M1 bars, by dataset and broker day.
 *
 * Why: a replay step used to send several bar queries to Postgres (find the
 * target minute, load the step's bars, mark positions). Bars of a READY
 * dataset are immutable (integrity triggers; a pinned dataset can't be
 * deleted), so they can be held in memory and every step after the first
 * touches the database only for account state.
 *
 * Physical availability ≠ logical visibility. This buffer may hold bars
 * AFTER an account's clock (it preloads ahead). It never decides what is
 * visible: every caller passes bounds it derived from the account's clock
 * under the account's row lock, and only bars ≤ that clock ever leave the
 * server. The buffer has no notion of users — it is keyed by dataset
 * sequence, and access control happens before it is consulted.
 *
 * Bounded: LRU by chunk with byte accounting (MAX_BYTES). One chunk is one
 * dataset-day (≤ 1,440 bars ≈ 60 KB). Missing chunks are loaded with ONE
 * query per call, concurrent loads of the same chunk share one promise, and
 * empty days are cached too so weekends cost nothing after the first visit.
 * Loads always use the shared client, never a caller's transaction: bars are
 * immutable (no locking needed), and a load shared by concurrent callers must
 * not depend on one caller's transaction staying open.
 */
import { prisma } from "@/server/db";
import { MINUTES_PER_DAY } from "@/domain/native-replay/wall-clock";

export interface BarChunk {
  seq: number;
  day: number;
  count: number;
  minute: Int32Array;
  open: Int32Array;
  high: Int32Array;
  low: Int32Array;
  close: Int32Array;
  /** NaN = null in the source row. */
  tickVolume: Float64Array;
  realVolume: Float64Array;
  spread: Float64Array;
}

/** ~40 MB: ~650 dataset-days of full M1 data. Measured per chunk in bytes(). */
export const MAX_BYTES = 40 * 1024 * 1024;

const chunks = new Map<string, BarChunk>(); // insertion order = LRU order
const inflight = new Map<string, Promise<void>>();
let bytes = 0;
const stats = { hits: 0, misses: 0, queries: 0, evictions: 0 };

const key = (seq: number, day: number) => `${seq}:${day}`;
export const dayOf = (minute: number) => Math.floor(minute / MINUTES_PER_DAY);
const sizeOf = (c: BarChunk) => c.count * (5 * 4 + 3 * 8) + 160;

function touch(k: string, c: BarChunk) {
  chunks.delete(k);
  chunks.set(k, c);
}

function store(c: BarChunk) {
  const k = key(c.seq, c.day);
  const old = chunks.get(k);
  if (old) bytes -= sizeOf(old);
  chunks.set(k, c);
  bytes += sizeOf(c);
  while (bytes > MAX_BYTES && chunks.size > 1) {
    const [oldestKey, oldest] = chunks.entries().next().value as [string, BarChunk];
    chunks.delete(oldestKey);
    bytes -= sizeOf(oldest);
    stats.evictions += 1;
  }
}

interface Row {
  seq: number;
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
}

function emptyChunk(seq: number, day: number, n: number): BarChunk {
  return {
    seq,
    day,
    count: n,
    minute: new Int32Array(n),
    open: new Int32Array(n),
    high: new Int32Array(n),
    low: new Int32Array(n),
    close: new Int32Array(n),
    tickVolume: new Float64Array(n),
    realVolume: new Float64Array(n),
    spread: new Float64Array(n),
  };
}

/**
 * Makes sure every (seq, day) for days [fromDay, toDay] is in memory, with at
 * most one query. Safe to call concurrently.
 */
export async function ensureDays(seqs: readonly number[], fromDay: number, toDay: number): Promise<void> {
  const missing: { seq: number; day: number }[] = [];
  const waits: Promise<void>[] = [];
  for (const seq of seqs) {
    for (let d = fromDay; d <= toDay; d++) {
      const k = key(seq, d);
      const c = chunks.get(k);
      if (c) {
        touch(k, c);
        stats.hits += 1;
        continue;
      }
      const p = inflight.get(k);
      if (p) waits.push(p);
      else missing.push({ seq, day: d });
    }
  }
  if (missing.length) {
    stats.misses += missing.length;
    const lo = Math.min(...missing.map((m) => m.day));
    const hi = Math.max(...missing.map((m) => m.day));
    const mSeqs = [...new Set(missing.map((m) => m.seq))];
    const load = (async () => {
      stats.queries += 1;
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT "datasetSeq" AS seq, "minute", "open", "high", "low", "close", "tickVolume", "realVolume", "spread"
        FROM "HistoricalBar"
        WHERE "datasetSeq" = ANY(${mSeqs}::int4[]) AND "minute" >= ${lo * MINUTES_PER_DAY} AND "minute" < ${(hi + 1) * MINUTES_PER_DAY}
        ORDER BY "datasetSeq", "minute" ASC
      `;
      const grouped = new Map<string, Row[]>();
      for (const r of rows) {
        const k = key(r.seq, dayOf(r.minute));
        let list = grouped.get(k);
        if (!list) grouped.set(k, (list = []));
        list.push(r);
      }
      for (const m of missing) {
        const list = grouped.get(key(m.seq, m.day)) ?? [];
        const c = emptyChunk(m.seq, m.day, list.length);
        list.forEach((r, i) => {
          c.minute[i] = r.minute;
          c.open[i] = r.open;
          c.high[i] = r.high;
          c.low[i] = r.low;
          c.close[i] = r.close;
          c.tickVolume[i] = r.tickVolume ?? NaN;
          c.realVolume[i] = r.realVolume ?? NaN;
          c.spread[i] = r.spread ?? NaN;
        });
        store(c);
      }
    })();
    for (const m of missing) inflight.set(key(m.seq, m.day), load);
    try {
      await load;
    } finally {
      for (const m of missing) inflight.delete(key(m.seq, m.day));
    }
  }
  if (waits.length) await Promise.all(waits.map((w) => w.catch(() => ensureDays(seqs, fromDay, toDay))));
}

/** The chunk if loaded (callers ensureDays first). */
export function chunk(seq: number, day: number): BarChunk | undefined {
  return chunks.get(key(seq, day));
}

export interface CacheBar {
  seq: number;
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
}

const nn = (v: number) => (Number.isNaN(v) ? null : v);

function barAt(c: BarChunk, i: number): CacheBar {
  return { seq: c.seq, minute: c.minute[i], open: c.open[i], high: c.high[i], low: c.low[i], close: c.close[i], tickVolume: nn(c.tickVolume[i]), realVolume: nn(c.realVolume[i]), spread: nn(c.spread[i]) };
}

/** First index in a chunk with minute > m (binary search). */
function upperBound(c: BarChunk, m: number): number {
  let lo = 0;
  let hi = c.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.minute[mid] <= m) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Bars of the given datasets with fromExclusive < minute ≤ toInclusive,
 * ascending by minute (ties in `seqs` order). Loads what's missing first.
 */
export async function barsBetween(seqs: readonly number[], fromExclusive: number, toInclusive: number): Promise<CacheBar[]> {
  if (toInclusive <= fromExclusive || seqs.length === 0) return [];
  const d0 = dayOf(fromExclusive + 1);
  const d1 = dayOf(toInclusive);
  await ensureDays(seqs, d0, d1);
  const out: CacheBar[] = [];
  for (const seq of seqs) {
    for (let d = d0; d <= d1; d++) {
      const c = chunks.get(key(seq, d))!;
      for (let i = upperBound(c, fromExclusive); i < c.count && c.minute[i] <= toInclusive; i++) out.push(barAt(c, i));
    }
  }
  if (seqs.length > 1) out.sort((a, b) => a.minute - b.minute || seqs.indexOf(a.seq) - seqs.indexOf(b.seq));
  return out;
}

/**
 * Distinct bar minutes of the datasets after `after`, up to `limit`
 * (inclusive), at most `count` of them — scanning forward day by day,
 * loading a few days per query. Used to find replay step targets.
 */
export async function minutesAfter(seqs: readonly number[], after: number, limit: number, count: number): Promise<number[]> {
  const out: number[] = [];
  if (seqs.length === 0 || limit <= after || count <= 0) return out;
  let day = dayOf(after + 1);
  const lastDay = dayOf(limit);
  const BATCH = 4;
  while (day <= lastDay && out.length < count) {
    const to = Math.min(lastDay, day + BATCH - 1);
    await ensureDays(seqs, day, to);
    for (let d = day; d <= to && out.length < count; d++) {
      const set = new Set<number>();
      for (const seq of seqs) {
        const c = chunks.get(key(seq, d))!;
        for (let i = upperBound(c, after); i < c.count && c.minute[i] <= limit; i++) set.add(c.minute[i]);
      }
      const sorted = [...set].sort((a, b) => a - b);
      for (const m of sorted) {
        out.push(m);
        if (out.length >= count) break;
      }
    }
    day = to + 1;
  }
  return out;
}

/** Latest bar minute in (after, upTo], or null. */
export async function lastMinuteIn(seqs: readonly number[], after: number, upTo: number): Promise<number | null> {
  if (seqs.length === 0 || upTo <= after) return null;
  const d0 = dayOf(after + 1);
  for (let d = dayOf(upTo); d >= d0; d -= 4) {
    const from = Math.max(d0, d - 3);
    await ensureDays(seqs, from, d);
    for (let dd = d; dd >= from; dd--) {
      let best: number | null = null;
      for (const seq of seqs) {
        const c = chunks.get(key(seq, dd))!;
        const i = upperBound(c, upTo) - 1;
        if (i >= 0 && c.minute[i] > after) best = best == null ? c.minute[i] : Math.max(best, c.minute[i]);
      }
      if (best != null) return best;
    }
  }
  return null;
}

/**
 * Each dataset's latest bar at or before `minute`, looking back at most
 * `maxDays` days (null for a dataset with no bar in that window — callers
 * fall back to the database).
 */
export async function latestAtOrBefore(seqs: readonly number[], minute: number, maxDays = 7): Promise<Map<number, CacheBar | null>> {
  const out = new Map<number, CacheBar | null>(seqs.map((s) => [s, null]));
  const top = dayOf(minute);
  await ensureDays(seqs, top - 1, top);
  for (const seq of seqs) {
    for (let d = top; d > top - maxDays; d--) {
      if (!chunks.has(key(seq, d))) await ensureDays([seq], Math.max(top - maxDays + 1, d - 3), d);
      const c = chunks.get(key(seq, d))!;
      const i = upperBound(c, minute) - 1;
      if (i >= 0) {
        out.set(seq, barAt(c, i));
        break;
      }
    }
  }
  return out;
}

/** Diagnostics for instrumentation and tests. */
export function barCacheStats() {
  return { ...stats, chunks: chunks.size, bytes, maxBytes: MAX_BYTES };
}

/** Tests only. */
export function resetBarCache(): void {
  chunks.clear();
  inflight.clear();
  bytes = 0;
  Object.assign(stats, { hits: 0, misses: 0, queries: 0, evictions: 0 });
}

/**
 * Background preload of the days after `minute` (called after a step's
 * response has been sent). Errors are swallowed: the next step simply
 * loads what it needs itself.
 */
export async function prefetchAfter(seqs: readonly number[], minute: number, days = 2): Promise<void> {
  if (!seqs.length) return;
  const d = dayOf(minute);
  try {
    await ensureDays(seqs, d, d + days);
  } catch (e) {
    console.warn("[bar-cache] prefetch failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Per-dataset statistics of one broker day [dayStart, dayEnd] (both inside
 * the same buffered day) plus the day's distinct timeline minutes — what the
 * Native Replay state reports. `world` = the replay position (null: none).
 */
export async function dayStats(seqs: readonly number[], dayStart: number, dayEnd: number, world: number | null) {
  const perSeq: { seq: number; first: number; last: number; count: number; latest: number | null }[] = [];
  const minutes = new Set<number>();
  const revealed = new Set<number>();
  if (seqs.length === 0) return { perSeq, minutes: 0, revealed: 0 };
  await ensureDays(seqs, dayOf(dayStart), dayOf(dayEnd));
  const w = world ?? -1;
  for (const seq of seqs) {
    let first = Infinity;
    let last = -Infinity;
    let count = 0;
    let latest: number | null = null;
    for (let d = dayOf(dayStart); d <= dayOf(dayEnd); d++) {
      const c = chunks.get(key(seq, d))!;
      for (let i = 0; i < c.count; i++) {
        const m = c.minute[i];
        if (m < dayStart || m > dayEnd) continue;
        count++;
        if (m < first) first = m;
        if (m > last) last = m;
        if (m <= w && (latest == null || m > latest)) latest = m;
        minutes.add(m);
        if (m <= w) revealed.add(m);
      }
    }
    if (count) perSeq.push({ seq, first, last, count, latest });
  }
  return { perSeq, minutes: minutes.size, revealed: revealed.size };
}
