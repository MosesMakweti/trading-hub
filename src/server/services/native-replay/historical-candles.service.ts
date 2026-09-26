/**
 * Native Replay — candle access for the (future) replay clock and chart.
 *
 * The ONLY way to read market data: consumers never query HistoricalBar
 * directly. Every call:
 *   1. verifies the dataset belongs to the user and is READY;
 *   2. fixes one cutoff (the replay position — default: the dataset's last
 *      bar) and fetches only M1 bars with `minute <= cutoff` — future bars
 *      never leave the database;
 *   3. aggregates with the pure engine (which re-applies the cutoff);
 *   4. returns ascending candles, COMPLETED / FORMING.
 */
import { prisma } from "@/server/db";
import { aggregateCandles, type CandleState, type EngineCandle } from "@/domain/native-replay/candle-engine";
import type { CanonicalM1Bars } from "@/domain/native-replay/m1-dataset";
import { bucketEnd, bucketStart, bucketStartBefore, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { formatWallClock, MINUTES_PER_DAY, type WallClockMinute } from "@/domain/native-replay/wall-clock";
import { requireReadyDataset } from "@/server/services/native-replay/historical-dataset.service";

export class CandleRangeTooLargeError extends Error {
  constructor() {
    super("That range is too large — request fewer candles.");
  }
}

/** First bucket start at or after `m`. */
function ceilBucket(m: WallClockMinute, tf: ReplayTimeframe): WallClockMinute {
  const start = bucketStart(m, tf);
  return start === m ? m : bucketEnd(start, tf);
}

export const DEFAULT_CANDLE_LIMIT = 500;
export const MAX_CANDLE_LIMIT = 5000;
/** Never fetch more M1 rows than this for one request (~2 years of M1). A
 *  limit-mode window that would exceed it starts later (bucket-aligned, so no
 *  candle is ever truncated) and reports `hasMoreBefore`. */
const MAX_M1_ROWS_PER_REQUEST = 800_000;
const MAX_WINDOW_EXTENSIONS = 6;

export interface CandleQuery {
  datasetId: string;
  timeframe: ReplayTimeframe;
  /** Replay position (wall-clock minute, inclusive). Defaults to the last bar. */
  cutoff?: WallClockMinute | null;
  /** Last bucket wanted (wall-clock minute inside it). Defaults to the cutoff; never later. */
  to?: WallClockMinute | null;
  /** First bucket wanted. When omitted, `limit` buckets ending at `to` are returned. */
  from?: WallClockMinute | null;
  limit?: number | null;
}

export interface CandleDTO {
  time: string; // bucket start, wall clock in the dataset's time basis
  minute: WallClockMinute;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
  barCount: number;
  state: CandleState;
}

export interface CandlesResult {
  datasetId: string;
  symbol: string;
  timeframe: ReplayTimeframe;
  timeBasis: "BROKER_SERVER";
  priceScale: number;
  /** The cutoff actually applied (clamped to the dataset). */
  cutoff: string | null;
  candles: CandleDTO[];
  /** True when older candles exist before the first returned one. */
  hasMoreBefore: boolean;
}

interface BarRow {
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  realVolume: number | null;
  spread: number | null;
}

/** Ascending M1 bars of one dataset in [from, to] — the only bar query. */
async function fetchBars(datasetSeq: number, from: number, to: number, flags: { tick: boolean; real: boolean; spread: boolean }): Promise<CanonicalM1Bars> {
  const rows = await prisma.$queryRaw<BarRow[]>`
    SELECT "minute", "open", "high", "low", "close", "tickVolume", "realVolume", "spread"
    FROM "HistoricalBar"
    WHERE "datasetSeq" = ${datasetSeq} AND "minute" BETWEEN ${from} AND ${to}
    ORDER BY "minute" ASC
  `;
  const n = rows.length;
  const bars: CanonicalM1Bars = {
    count: n,
    minute: new Int32Array(n),
    open: new Int32Array(n),
    high: new Int32Array(n),
    low: new Int32Array(n),
    close: new Int32Array(n),
    tickVolume: flags.tick ? new Int32Array(n) : null,
    realVolume: flags.real ? new Float64Array(n) : null,
    spread: flags.spread ? new Int32Array(n) : null,
  };
  for (let i = 0; i < n; i += 1) {
    const r = rows[i];
    bars.minute[i] = r.minute;
    bars.open[i] = r.open;
    bars.high[i] = r.high;
    bars.low[i] = r.low;
    bars.close[i] = r.close;
    if (bars.tickVolume) bars.tickVolume[i] = r.tickVolume ?? 0;
    if (bars.realVolume) bars.realVolume[i] = r.realVolume ?? 0;
    if (bars.spread) bars.spread[i] = r.spread ?? 0;
  }
  return bars;
}

function concatBars(chunks: CanonicalM1Bars[]): CanonicalM1Bars {
  if (chunks.length === 1) return chunks[0];
  const n = chunks.reduce((s, c) => s + c.count, 0);
  const pick = <T extends Int32Array | Float64Array>(get: (c: CanonicalM1Bars) => T | null, make: (n: number) => T): T | null => {
    if (get(chunks[0]) == null) return null;
    const out = make(n);
    let offset = 0;
    for (const c of chunks) {
      out.set(get(c)!.subarray(0, c.count), offset);
      offset += c.count;
    }
    return out;
  };
  const i32 = (len: number) => new Int32Array(len);
  return {
    count: n,
    minute: pick((c) => c.minute, i32)!,
    open: pick((c) => c.open, i32)!,
    high: pick((c) => c.high, i32)!,
    low: pick((c) => c.low, i32)!,
    close: pick((c) => c.close, i32)!,
    tickVolume: pick((c) => c.tickVolume, i32),
    realVolume: pick((c) => c.realVolume, (len) => new Float64Array(len)),
    spread: pick((c) => c.spread, i32),
  };
}

/** Initial lookback: `limit` buckets plus slack for weekends/closures —
 *  always bucket-aligned, so the oldest candle is never cut in half. */
function initialFrom(toBucket: WallClockMinute, tf: ReplayTimeframe, limit: number): WallClockMinute {
  const start = bucketStartBefore(toBucket, tf, limit - 1);
  if (tf === "W1" || tf === "MN1") return start;
  const span = toBucket - start;
  return bucketStart(toBucket - Math.ceil(span * 1.45) - 3 * MINUTES_PER_DAY, tf);
}

export async function getHistoricalCandles(userId: string, query: CandleQuery): Promise<CandlesResult> {
  const ds = await requireReadyDataset(userId, query.datasetId);
  const tf = query.timeframe;
  const flags = { tick: ds.hasTickVolume, real: ds.hasRealVolume, spread: ds.hasSpread };
  const first = ds.firstBarMinute!;
  const last = ds.lastBarMinute!;
  const cutoff = Math.min(query.cutoff ?? last, last);
  const base: Omit<CandlesResult, "candles" | "hasMoreBefore" | "cutoff"> = {
    datasetId: ds.id,
    symbol: ds.symbol,
    timeframe: tf,
    timeBasis: ds.timeBasis,
    priceScale: ds.priceScale,
  };
  if (cutoff < first) return { ...base, cutoff: formatWallClock(cutoff), candles: [], hasMoreBefore: false };

  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_CANDLE_LIMIT)), MAX_CANDLE_LIMIT);
  const toBucket = bucketStart(Math.min(query.to ?? cutoff, cutoff), tf);
  const upper = Math.min(bucketEnd(toBucket, tf) - 1, cutoff);

  // Row budget, enforced BEFORE querying: a dataset has at most one bar per
  // minute, so bounding the minute span bounds the rows fetched.
  const budgetFloor = ceilBucket(upper - MAX_M1_ROWS_PER_REQUEST + 1, tf);
  let lower: number;
  const chunks: CanonicalM1Bars[] = [];
  const fetchRange = async (from: number, to: number) => {
    const clampedFrom = Math.max(from, first);
    if (clampedFrom > to) return;
    chunks.unshift(await fetchBars(ds.seq, clampedFrom, to, flags));
  };

  let candles: EngineCandle[];
  if (query.from != null) {
    lower = bucketStart(query.from, tf);
    if (upper - Math.max(lower, first) + 1 > MAX_M1_ROWS_PER_REQUEST) throw new CandleRangeTooLargeError();
    await fetchRange(lower, upper);
    candles = aggregateCandles(concatBars(chunks.length ? chunks : [emptyBars(flags)]), { timeframe: tf, cutoff, fromBucket: lower });
  } else {
    lower = Math.max(initialFrom(toBucket, tf, limit), budgetFloor);
    await fetchRange(lower, upper);
    candles = aggregateCandles(concatBars(chunks.length ? chunks : [emptyBars(flags)]), { timeframe: tf, cutoff });
    for (let i = 0; candles.length < limit && lower > first && i < MAX_WINDOW_EXTENSIONS; i += 1) {
      const span = Math.max(upper - lower, MINUTES_PER_DAY);
      const nextLower = Math.max(bucketStart(lower - span, tf), budgetFloor);
      if (nextLower >= lower) break; // budget exhausted
      await fetchRange(nextLower, lower - 1);
      lower = nextLower;
      candles = aggregateCandles(concatBars(chunks), { timeframe: tf, cutoff });
    }
  }

  const trimmed = candles.length > limit ? candles.slice(candles.length - limit) : candles;
  const hasMoreBefore = trimmed.length > 0 && trimmed[0].time > bucketStart(first, tf);

  const scale = 10 ** ds.priceScale;
  return {
    ...base,
    cutoff: formatWallClock(cutoff),
    hasMoreBefore,
    candles: trimmed.map((c) => ({
      time: formatWallClock(c.time),
      minute: c.time,
      open: c.open / scale,
      high: c.high / scale,
      low: c.low / scale,
      close: c.close / scale,
      tickVolume: c.tickVolume,
      realVolume: c.realVolume,
      spread: c.spread,
      barCount: c.barCount,
      state: c.state,
    })),
  };
}

function emptyBars(flags: { tick: boolean; real: boolean; spread: boolean }): CanonicalM1Bars {
  return {
    count: 0,
    minute: new Int32Array(0),
    open: new Int32Array(0),
    high: new Int32Array(0),
    low: new Int32Array(0),
    close: new Int32Array(0),
    tickVolume: flags.tick ? new Int32Array(0) : null,
    realVolume: flags.real ? new Float64Array(0) : null,
    spread: flags.spread ? new Int32Array(0) : null,
  };
}
