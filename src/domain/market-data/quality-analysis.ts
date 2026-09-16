/**
 * Stage 21.2 §17 — a deterministic, objective quality analyzer for a
 * requested historical candle range. Pure and synchronous: takes whatever
 * candle array a caller already fetched (raw, pre-dedup order preserved)
 * and reports facts about it — never a subjective verdict ("Excellent"/
 * "Poor"), only counts a caller (or a future UI) can interpret.
 *
 * GAP CLASSIFICATION IS DELIBERATELY LIMITED (§8): this module can only
 * distinguish "falls on a UTC Saturday/Sunday" (WEEKEND) from everything
 * else (UNEXPECTED) — it has no trading-calendar/session-hours knowledge
 * (public holidays, futures maintenance windows, forex broker rollover
 * gaps, etc.). A gap classified UNEXPECTED is NOT necessarily a bug — it
 * may be a legitimate holiday or session closure this module simply can't
 * recognize yet. Do not treat UNEXPECTED as "confirmed provider error"
 * without a human (or a future real session-calendar) checking it.
 */
import { isValidCandle, type Candle } from "@/domain/market-data/candle";
import { timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";

const DAY_MS = 86_400_000;

export type GapClassification = "WEEKEND" | "UNEXPECTED";

export interface MissingIntervalGap {
  /** UTC ms — the first missing interval's own timestamp. */
  from: number;
  /** UTC ms — the last missing interval's own timestamp. */
  to: number;
  /** Number of missing `timeframe`-sized intervals in this contiguous run. */
  count: number;
  classification: GapClassification;
}

export interface MarketDataQualityReport {
  timeframe: Timeframe;
  rangeFrom: number;
  rangeTo: number;
  /** Total `timeframe`-sized slots between rangeFrom and rangeTo, inclusive
   *  — a calendar count, NOT adjusted for weekends/holidays (§17: "expected
   *  intervals" is the raw slot count; gap classification below is what
   *  distinguishes legitimate closures from real gaps). */
  expectedIntervals: number;
  /** Deduped, valid, in-range candle count — what Replay would actually render. */
  actualCandles: number;
  /** Exact-timestamp duplicates found in the INPUT array (0 once a provider
   *  adapter's own dedup has already run — this counts what was fed in, so
   *  a caller can verify upstream dedup is actually doing its job). */
  duplicateCount: number;
  /** Adjacent-pair inversions in the INPUT array's original order (a cheap,
   *  deterministic proxy for "was this already sorted ascending" — the
   *  same discipline every provider adapter's own `.sort(compareCandles)`
   *  exists to fix, made independently verifiable here). */
  outOfOrderCount: number;
  /** Candles that failed `isValidCandle` (non-finite, high<low, etc.) —
   *  excluded from `actualCandles` and from gap/aggregation computation. */
  invalidCandleCount: number;
  /** Always 0 in this codebase (§9) — no synthetic/fabricated candle
   *  generation exists anywhere in the pipeline; kept as an explicit field
   *  so this analyzer's shape doesn't need to change if that ever becomes
   *  false, and so a Candle Trace/MT5-import report can surface it plainly. */
  syntheticCandleCount: number;
  missingIntervals: MissingIntervalGap[];
  longestUnexpectedGapIntervals: number;
  /** actualCandles / expectedIntervals * 100, rounded to 2 decimals — a
   *  raw ratio, NOT "corrected" for expected closures. A 71% coverage on a
   *  5-day forex week is entirely normal (weekends), not a defect; that
   *  distinction is what `missingIntervals[].classification` is for. */
  coveragePercent: number;
}

function isUtcWeekendDay(ms: number): boolean {
  const day = new Date(Math.floor(ms / DAY_MS) * DAY_MS).getUTCDay();
  return day === 0 || day === 6;
}

/** A gap's classification is WEEKEND only when EVERY missing interval in it
 *  falls on a UTC Saturday/Sunday — a gap that straddles a weekend boundary
 *  (e.g. Friday evening into Monday, common for forex) still counts as
 *  UNEXPECTED overall unless the whole run is weekend-only, so a real
 *  Friday-close/Monday-open provider gap is never silently hidden inside a
 *  "weekend" label. */
function classifyGap(fromMs: number, toMs: number, stepMs: number): GapClassification {
  for (let t = fromMs; t <= toMs; t += stepMs) {
    if (!isUtcWeekendDay(t)) return "UNEXPECTED";
  }
  return "WEEKEND";
}

export function analyzeMarketDataQuality(rawCandles: Candle[], timeframe: Timeframe, rangeFrom: number, rangeTo: number): MarketDataQualityReport {
  const stepMs = timeframeToMs(timeframe);
  const expectedIntervals = rangeTo >= rangeFrom ? Math.floor((rangeTo - rangeFrom) / stepMs) + 1 : 0;

  let outOfOrderCount = 0;
  for (let i = 1; i < rawCandles.length; i += 1) {
    if (rawCandles[i].timestamp < rawCandles[i - 1].timestamp) outOfOrderCount += 1;
  }

  const inRange = rawCandles.filter((c) => c.timestamp >= rangeFrom && c.timestamp <= rangeTo);
  const invalidCandleCount = inRange.filter((c) => !isValidCandle(c)).length;
  const valid = inRange.filter(isValidCandle);

  const sorted = [...valid].sort((a, b) => a.timestamp - b.timestamp);
  const byTimestamp = new Map<number, Candle>();
  let duplicateCount = 0;
  for (const c of sorted) {
    if (byTimestamp.has(c.timestamp)) duplicateCount += 1;
    else byTimestamp.set(c.timestamp, c);
  }
  const deduped = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);

  const missingIntervals: MissingIntervalGap[] = [];
  let cursor = rangeFrom;
  for (const c of deduped) {
    if (c.timestamp > cursor) {
      const gapCount = Math.round((c.timestamp - cursor) / stepMs);
      if (gapCount > 0) {
        const gapTo = c.timestamp - stepMs;
        missingIntervals.push({ from: cursor, to: gapTo, count: gapCount, classification: classifyGap(cursor, gapTo, stepMs) });
      }
    }
    cursor = c.timestamp + stepMs;
  }
  if (cursor <= rangeTo) {
    const gapCount = Math.round((rangeTo - cursor) / stepMs) + 1;
    if (gapCount > 0) missingIntervals.push({ from: cursor, to: rangeTo, count: gapCount, classification: classifyGap(cursor, rangeTo, stepMs) });
  }

  const longestUnexpectedGapIntervals = missingIntervals.filter((g) => g.classification === "UNEXPECTED").reduce((max, g) => Math.max(max, g.count), 0);

  return {
    timeframe,
    rangeFrom,
    rangeTo,
    expectedIntervals,
    actualCandles: deduped.length,
    duplicateCount,
    outOfOrderCount,
    invalidCandleCount,
    syntheticCandleCount: 0,
    missingIntervals,
    longestUnexpectedGapIntervals,
    coveragePercent: expectedIntervals > 0 ? Math.round((deduped.length / expectedIntervals) * 10000) / 100 : 0,
  };
}
