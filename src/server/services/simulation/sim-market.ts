/**
 * Market data for simulation accounts — every read is bounded by a minute
 * the caller resolved from the account's own clock. Nothing here accepts a
 * browser-chosen cutoff (docs/SIMULATION_PLATFORM.md §5).
 */
import { prisma, type TransactionClient } from "@/server/db";
import { bucketEnd, bucketStart, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { MINUTES_PER_DAY, parseWallClock } from "@/domain/native-replay/wall-clock";
import { utcDateToKey } from "@/lib/date";
import type { SimBar } from "@/domain/simulation/market";
import { barsBetween, lastMinuteIn, latestAtOrBefore, minutesAfter } from "@/server/services/market-data/bar-cache";

type Db = TransactionClient | typeof prisma;

export interface SimFeed {
  symbol: string;
  datasetId: string;
  seq: number;
  priceScale: number;
}

/** The account's pinned, READY datasets. */
export async function accountFeeds(db: Db, accountId: string): Promise<SimFeed[]> {
  return db.$queryRaw<SimFeed[]>`
    SELECT p."assetSymbol" AS symbol, d."id" AS "datasetId", d."seq" AS seq, d."priceScale" AS "priceScale"
    FROM "SimDatasetPin" p JOIN "HistoricalDataset" d ON d."id" = p."datasetId"
    WHERE p."accountId" = ${accountId} AND d."status" = 'READY'
    ORDER BY p."assetSymbol"
  `;
}

/**
 * `accountFeeds`, remembered per account. An account's pins are written once
 * when it is created and never change, and a pinned dataset can't be deleted
 * (FK NO ACTION), so the answer is immutable for the account's lifetime.
 */
const feedsByAccount = new Map<string, SimFeed[]>();
export async function accountFeedsCached(db: Db, accountId: string): Promise<SimFeed[]> {
  const hit = feedsByAccount.get(accountId);
  if (hit) return hit;
  const feeds = await accountFeeds(db, accountId);
  if (feeds.length) {
    if (feedsByAccount.size >= 5000) feedsByAccount.delete(feedsByAccount.keys().next().value as string);
    feedsByAccount.set(accountId, feeds);
  }
  return feeds;
}

/** First and last broker minute of an account's inclusive period. */
export function periodMinutes(period: { periodStart: Date; periodEnd: Date }): { from: number; to: number } {
  return {
    from: parseWallClock(`${utcDateToKey(period.periodStart)}T00:00`)!,
    to: parseWallClock(`${utcDateToKey(period.periodEnd)}T00:00`)! + MINUTES_PER_DAY - 1,
  };
}

interface BarRow {
  seq: number;
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number | null;
}

const toBar = (r: BarRow): SimBar => ({ minute: r.minute, open: r.open, high: r.high, low: r.low, close: r.close, spread: r.spread ?? 0 });

/** Bars of every feed in (fromExclusive, toInclusive], grouped by symbol, plus the union timeline. */
export async function loadStepBars(db: Db, feeds: SimFeed[], fromExclusive: number, toInclusive: number): Promise<{ bars: Map<string, Map<number, SimBar>>; timeline: number[] }> {
  const bars = new Map<string, Map<number, SimBar>>(feeds.map((f) => [f.symbol, new Map()]));
  if (feeds.length === 0 || toInclusive <= fromExclusive) return { bars, timeline: [] };
  const symbolBySeq = new Map(feeds.map((f) => [f.seq, f.symbol]));
  const rows = await db.$queryRaw<BarRow[]>`
    SELECT "datasetSeq" AS seq, "minute", "open", "high", "low", "close", "spread"
    FROM "HistoricalBar"
    WHERE "datasetSeq" = ANY(${feeds.map((f) => f.seq)}::int4[]) AND "minute" > ${fromExclusive} AND "minute" <= ${toInclusive}
    ORDER BY "minute" ASC
  `;
  const minutes = new Set<number>();
  for (const r of rows) {
    bars.get(symbolBySeq.get(r.seq)!)!.set(r.minute, toBar(r));
    minutes.add(r.minute);
  }
  return { bars, timeline: [...minutes].sort((a, b) => a - b) };
}

/** Each feed's latest bar at or before `minute` (its current quote). */
export async function latestBars(db: Db, feeds: SimFeed[], minute: number): Promise<Map<string, SimBar>> {
  const out = new Map<string, SimBar>();
  if (feeds.length === 0) return out;
  const rows = await db.$queryRaw<BarRow[]>`
    SELECT DISTINCT ON ("datasetSeq") "datasetSeq" AS seq, "minute", "open", "high", "low", "close", "spread"
    FROM "HistoricalBar"
    WHERE "datasetSeq" = ANY(${feeds.map((f) => f.seq)}::int4[]) AND "minute" <= ${minute}
    ORDER BY "datasetSeq", "minute" DESC
  `;
  const symbolBySeq = new Map(feeds.map((f) => [f.seq, f.symbol]));
  for (const r of rows) out.set(symbolBySeq.get(r.seq)!, toBar(r));
  return out;
}

/** The first timeline minute at or after `minute` (inclusive) and up to `limit`. */
export async function firstMinuteFrom(db: Db, feeds: SimFeed[], minute: number, limit: number): Promise<number | null> {
  if (feeds.length === 0) return null;
  const [row] = await db.$queryRaw<{ m: number | null }[]>`
    SELECT min("minute") AS m FROM "HistoricalBar"
    WHERE "datasetSeq" = ANY(${feeds.map((f) => f.seq)}::int4[]) AND "minute" >= ${minute} AND "minute" <= ${limit}
  `;
  return row.m;
}

export type ClockCommand =
  | { kind: "BARS"; count: number }
  /** Finish the current `timeframe` candle, then `count - 1` more (default 1). */
  | { kind: "CANDLE"; timeframe: ReplayTimeframe; count?: number }
  /** AT_OR_BEFORE (default): the last bar ≤ `to`. AT_OR_AFTER: the first bar ≥ `to` (session starts). */
  | { kind: "SEEK"; to: number; align?: "AT_OR_BEFORE" | "AT_OR_AFTER"; until?: number }
  | { kind: "NEXT_DAY" };

/** Largest single move: a +N step, or a seek / next-day jump, in timeline minutes or calendar span. */
export const MAX_STEP_BARS = 1440;
export const MAX_SEEK_MINUTES = 31 * MINUTES_PER_DAY;

/**
 * Target world minute for a command from `cur`, never past `limit` (the
 * period end). Null = nothing to move to. Pure SQL over immutable bars.
 */
export async function targetMinute(db: Db, feeds: SimFeed[], cur: number, command: ClockCommand, limit: number, dailyResetHour: number): Promise<number | null> {
  const seqs = feeds.map((f) => f.seq);
  if (seqs.length === 0) return null;
  if (command.kind === "BARS") {
    const [row] = await db.$queryRaw<{ m: number | null }[]>`
      SELECT max(m) AS m FROM (
        SELECT DISTINCT "minute" AS m FROM "HistoricalBar"
        WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" > ${cur} AND "minute" <= ${limit}
        ORDER BY m LIMIT ${command.count}
      ) s
    `;
    return row.m;
  }
  if (command.kind === "CANDLE") {
    const next = await firstMinuteFrom(db, feeds, cur + 1, limit);
    if (next == null) return null;
    const candleLast = Math.min(bucketEnd(bucketStart(next, command.timeframe), command.timeframe) - 1, limit);
    const [row] = await db.$queryRaw<{ m: number | null }[]>`
      SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" BETWEEN ${next} AND ${candleLast}
    `;
    return row.m;
  }
  const lastBarUpTo = async (to: number) => {
    const bounded = Math.min(to, limit, cur + MAX_SEEK_MINUTES);
    const [row] = await db.$queryRaw<{ m: number | null }[]>`
      SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" > ${cur} AND "minute" <= ${bounded}
    `;
    return row.m;
  };
  if (command.kind === "SEEK") return lastBarUpTo(command.to);

  // NEXT_DAY: finish the current trading day (its last bar before the next
  // daily reset); if it is already finished, finish the next day that has data.
  const dayEnd = (m: number) => Math.floor((m - dailyResetHour * 60) / MINUTES_PER_DAY + 1) * MINUTES_PER_DAY + dailyResetHour * 60 - 1;
  const inDay = await lastBarUpTo(dayEnd(cur));
  if (inDay != null) return inDay;
  const next = await firstMinuteFrom(db, feeds, cur + 1, Math.min(limit, cur + MAX_SEEK_MINUTES));
  return next == null ? null : lastBarUpTo(dayEnd(next));
}

// ── Buffered reads (server-side bar buffer, market-data/bar-cache.ts) ──────
// Same contract and results as the SQL functions above (tested for
// equivalence); they read immutable bars from the server's private buffer so
// a replay step needs no bar queries once the buffer is warm. Bounds still
// come from the account clock — the buffer never decides visibility.

/** Buffered `targetMinute`. */
export async function targetMinuteBuffered(feeds: SimFeed[], cur: number, command: ClockCommand, limit: number, dailyResetHour: number): Promise<number | null> {
  const seqs = feeds.map((f) => f.seq);
  if (seqs.length === 0) return null;
  if (command.kind === "BARS") {
    const ms = await minutesAfter(seqs, cur, limit, command.count);
    return ms.length ? ms[ms.length - 1] : null;
  }
  const firstFrom = async (fromInclusive: number, upTo: number) => (await minutesAfter(seqs, fromInclusive - 1, upTo, 1))[0] ?? null;
  if (command.kind === "CANDLE") {
    // `count` playback candles: each one finishes the candle the next bar belongs to.
    let at = cur;
    for (let k = 0; k < Math.max(1, command.count ?? 1); k++) {
      const next = await firstFrom(at + 1, limit);
      if (next == null) break;
      const candleLast = Math.min(bucketEnd(bucketStart(next, command.timeframe), command.timeframe) - 1, limit);
      const end = await lastMinuteIn(seqs, next - 1, candleLast);
      if (end == null) break;
      at = end;
    }
    return at > cur ? at : null;
  }
  const lastBarUpTo = (to: number) => lastMinuteIn(seqs, cur, Math.min(to, limit, cur + MAX_SEEK_MINUTES));
  if (command.kind === "SEEK") {
    if (command.align === "AT_OR_AFTER") {
      // First bar at or after `to` — never before the clock, never past the period or the seek window.
      // `until` (exclusive) keeps a session jump inside the session: no bar there → no move.
      return firstFrom(Math.max(command.to, cur + 1), Math.min(limit, cur + MAX_SEEK_MINUTES, (command.until ?? Infinity) - 1));
    }
    return lastBarUpTo(command.to);
  }
  const dayEnd = (m: number) => Math.floor((m - dailyResetHour * 60) / MINUTES_PER_DAY + 1) * MINUTES_PER_DAY + dailyResetHour * 60 - 1;
  const inDay = await lastBarUpTo(dayEnd(cur));
  if (inDay != null) return inDay;
  const next = await firstFrom(cur + 1, Math.min(limit, cur + MAX_SEEK_MINUTES));
  return next == null ? null : lastBarUpTo(dayEnd(next));
}

/** Buffered `loadStepBars`. */
export async function loadStepBarsBuffered(feeds: SimFeed[], fromExclusive: number, toInclusive: number): Promise<{ bars: Map<string, Map<number, SimBar>>; timeline: number[] }> {
  const bars = new Map<string, Map<number, SimBar>>(feeds.map((f) => [f.symbol, new Map()]));
  if (feeds.length === 0 || toInclusive <= fromExclusive) return { bars, timeline: [] };
  const symbolBySeq = new Map(feeds.map((f) => [f.seq, f.symbol]));
  const rows = await barsBetween(feeds.map((f) => f.seq), fromExclusive, toInclusive);
  const minutes = new Set<number>();
  for (const r of rows) {
    bars.get(symbolBySeq.get(r.seq)!)!.set(r.minute, toBar(r));
    minutes.add(r.minute);
  }
  return { bars, timeline: [...minutes].sort((a, b) => a - b) };
}

/** Buffered `latestBars` (falls back to SQL for a feed with no bar in the last week). */
export async function latestBarsBuffered(feeds: SimFeed[], minute: number): Promise<Map<string, SimBar>> {
  const out = new Map<string, SimBar>();
  if (feeds.length === 0) return out;
  const found = await latestAtOrBefore(feeds.map((f) => f.seq), minute);
  const missing: SimFeed[] = [];
  for (const f of feeds) {
    const b = found.get(f.seq);
    if (b) out.set(f.symbol, toBar(b));
    else missing.push(f);
  }
  if (missing.length) for (const [k, v] of await latestBars(prisma, missing, minute)) out.set(k, v);
  return out;
}

/** Revealed M1 bars of one feed in (fromExclusive, toInclusive], as wire bars (decimal prices). */
export async function revealedWireBars(feed: SimFeed, fromExclusive: number, toInclusive: number) {
  const rows = await barsBetween([feed.seq], fromExclusive, toInclusive);
  const s = 10 ** feed.priceScale;
  return rows.map((r) => ({
    minute: r.minute,
    open: r.open / s,
    high: r.high / s,
    low: r.low / s,
    close: r.close / s,
    tickVolume: r.tickVolume,
    realVolume: r.realVolume,
    spread: r.spread,
    barCount: 1,
    state: "COMPLETED" as const,
  }));
}

/**
 * Review navigation (read-only): a target minute for looking back over what
 * the account has ALREADY revealed. Always ≤ `clock` — it can never reach a
 * bar the account hasn't revealed. Null = nothing there.
 *  - BACK: the end of the previous `timeframe` bucket before `from`.
 *  - FORWARD: the end of the next `timeframe` bucket after `from`, capped at the clock.
 *  - SEEK: the last bar ≤ min(to, clock).
 */
export async function reviewTarget(
  feeds: SimFeed[],
  from: number,
  clock: number,
  periodFrom: number,
  move: { kind: "BACK" | "FORWARD"; timeframe: ReplayTimeframe } | { kind: "SEEK"; to: number; align?: "AT_OR_BEFORE" | "AT_OR_AFTER"; until?: number },
): Promise<number | null> {
  const seqs = feeds.map((f) => f.seq);
  if (!seqs.length) return null;
  const at = Math.min(from, clock);
  if (move.kind === "SEEK") {
    if (move.align === "AT_OR_AFTER") {
      const upTo = Math.min(clock, (move.until ?? Infinity) - 1);
      return upTo < move.to ? null : ((await minutesAfter(seqs, move.to - 1, upTo, 1))[0] ?? null);
    }
    return lastMinuteIn(seqs, periodFrom - 1, Math.min(move.to, clock));
  }
  if (move.kind === "FORWARD") return targetMinuteBuffered(feeds, at, { kind: "CANDLE", timeframe: move.timeframe }, clock, 0);
  // Whether the current bucket is complete or still forming, one step back ends
  // at the last bar before it starts (for M1: the previous minute).
  const start = bucketStart(at, move.timeframe);
  return lastMinuteIn(seqs, Math.max(periodFrom - 1, start - MAX_SEEK_MINUTES - 1), start - 1);
}
