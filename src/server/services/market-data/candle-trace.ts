/**
 * Stage 21.2 §16 — the Candle Trace diagnostic: traces ONE requested
 * display-timeframe candle through the ENTIRE Replay pipeline (provider →
 * canonical M1 → aggregation → no-hindsight visibility), answering exactly
 * the question this stage's audit needed to answer for every candle:
 * "what did the source say, and does Traditorium display exactly that, at
 * exactly the right historical time?"
 *
 * Composes EXISTING pipeline functions only (`getHistoricalCandles`,
 * `aggregateCandles`, `bucketStart`, `analyzeMarketDataQuality`) — this
 * never recomputes candle math independently, so a trace can never
 * disagree with what Replay itself would show. Developer/debug tooling
 * only (mirrors `diagnostic.ts`'s own precedent) — never imported from a
 * "use client" file, never exposed as a route, never logs/returns a
 * provider API key.
 */
import { aggregateCandles, bucketStart } from "@/domain/market-data/aggregation";
import { analyzeMarketDataQuality, type MarketDataQualityReport } from "@/domain/market-data/quality-analysis";
import { timeframeToMs, type Timeframe } from "@/domain/market-data/timeframe";
import { getHistoricalCandles, getMarketDataProviderInfo } from "@/server/services/market-data.service";

export interface CandleTraceResult {
  ok: true;
  symbol: string;
  requestedTimeframe: Timeframe;
  /** UTC ms — the traced display-timeframe candle's own OPEN timestamp
   *  (the start of its bucket, matching `Candle.timestamp`'s convention). */
  displayTimestamp: number;
  provider: string;
  providerDisplayName: string;
  baseTimeframe: Timeframe;
  /** The M1 window this display candle is built from — inclusive UTC ms. */
  canonicalM1Range: { from: number; to: number };
  constituentCount: number;
  /** Null when zero constituent candles exist for this bucket (a genuine
   *  gap, e.g. a weekend) — never fabricated. */
  ohlc: { open: number; high: number; low: number; close: number } | null;
  /** UTC ms — when the no-hindsight rule (`timestamp + duration <= clock`)
   *  first allows this candle to render; identical formula Replay itself uses. */
  replayVisibleAt: number;
  /** Always 0 — see `quality-analysis.ts`'s own doc comment; no synthetic
   *  candle generation exists anywhere in this codebase (verified Stage 21.2 §9). */
  syntheticCandles: number;
  /** One entry per distinct provider/contract segment the M1 range was
   *  actually served from (a rollover can span more than one). */
  cacheChunks: { providerId: string; datasetId?: string; priceBasis?: string; segments: { contractSymbol: string; from: number; to: number }[] }[];
  /** The deterministic quality report (§17) for exactly this candle's own
   *  constituent M1 window — lets a developer see duplicate/gap/ordering
   *  facts for the SAME window the OHLC above was computed from. */
  quality: MarketDataQualityReport;
}

export interface CandleTraceError {
  ok: false;
  error: string;
}

/**
 * `timestamp` may be any instant within the target bucket — it's snapped to
 * the bucket's own start via `bucketStart` before anything else, exactly
 * like every other Replay component treats a display-timeframe candle.
 */
export async function traceReplayCandle(params: { canonicalSymbol: string; timestamp: number; timeframe: Timeframe }): Promise<CandleTraceResult | CandleTraceError> {
  const bucketStartMs = bucketStart(params.timestamp, params.timeframe);
  const durationMs = timeframeToMs(params.timeframe);
  const bucketEndMs = bucketStartMs + durationMs - 1;

  const providerInfo = getMarketDataProviderInfo(params.canonicalSymbol);
  const result = await getHistoricalCandles(params.canonicalSymbol, bucketStartMs, bucketEndMs);
  if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };

  const aggregated = params.timeframe === providerInfo.baseTimeframe ? result.candles : aggregateCandles(result.candles, params.timeframe);
  const bucket = aggregated.find((c) => c.timestamp === bucketStartMs) ?? null;

  const quality = analyzeMarketDataQuality(result.candles, providerInfo.baseTimeframe as Timeframe, bucketStartMs, bucketEndMs);

  return {
    ok: true,
    symbol: params.canonicalSymbol,
    requestedTimeframe: params.timeframe,
    displayTimestamp: bucketStartMs,
    provider: providerInfo.id,
    providerDisplayName: providerInfo.displayName,
    baseTimeframe: providerInfo.baseTimeframe as Timeframe,
    canonicalM1Range: { from: bucketStartMs, to: bucketEndMs },
    constituentCount: result.candles.length,
    ohlc: bucket ? { open: bucket.open, high: bucket.high, low: bucket.low, close: bucket.close } : null,
    replayVisibleAt: bucketStartMs + durationMs,
    syntheticCandles: 0,
    cacheChunks: result.provenance.map((p) => ({ providerId: p.providerId, datasetId: p.datasetId, priceBasis: p.priceBasis, segments: p.segments })),
    quality,
  };
}

/** Plain-text rendering matching this stage's own example output shape —
 *  console/log inspection only, never a UI component. */
export function formatCandleTrace(trace: CandleTraceResult): string {
  const lines = [
    `Symbol: ${trace.symbol}`,
    `Requested TF: ${trace.requestedTimeframe}`,
    `Display timestamp: ${new Date(trace.displayTimestamp).toISOString()}`,
    `Provider: ${trace.providerDisplayName} (${trace.provider})`,
    `Canonical M1 range: ${new Date(trace.canonicalM1Range.from).toISOString()} .. ${new Date(trace.canonicalM1Range.to).toISOString()}`,
    `Constituent count: ${trace.constituentCount}`,
    trace.ohlc
      ? `Open: ${trace.ohlc.open}  High: ${trace.ohlc.high}  Low: ${trace.ohlc.low}  Close: ${trace.ohlc.close}`
      : "Open/High/Low/Close: no data for this bucket (genuine gap — never fabricated)",
    `Replay visible at: ${new Date(trace.replayVisibleAt).toISOString()}`,
    `Synthetic/gap candles: ${trace.syntheticCandles}`,
    `Cache chunks: ${trace.cacheChunks.length} (${trace.cacheChunks.map((c) => `${c.providerId}${c.datasetId ? `/${c.datasetId}` : ""}`).join(", ") || "none"})`,
    `Quality — coverage: ${trace.quality.coveragePercent}%, duplicates: ${trace.quality.duplicateCount}, out-of-order: ${trace.quality.outOfOrderCount}, invalid: ${trace.quality.invalidCandleCount}, missing gaps: ${trace.quality.missingIntervals.length}`,
  ];
  return lines.join("\n");
}
