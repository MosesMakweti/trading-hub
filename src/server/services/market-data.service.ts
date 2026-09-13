import { FixtureMarketDataProvider } from "@/domain/market-data/providers/fixture-provider";
import { DatabentoHistoricalMarketDataProvider } from "@/server/services/market-data/databento-provider";
import type { Candle } from "@/domain/market-data/candle";
import type { CandleProvenance, FetchCandlesResult, HistoricalMarketDataProvider } from "@/domain/market-data/provider-types";

/**
 * Canonical futures symbols Databento is the production candidate for
 * (Stage 17B). Everything else (forex, XAUUSD, indices) stays on Fixture
 * until a Stage 17C provider is chosen — this list is intentionally NOT
 * "every FUTURES-class instrument in the catalog," only the ones this
 * stage's adapter actually resolves (see databento-provider.ts's own doc
 * comment on why MGC/MES/MNQ collapse into GC/ES/NQ here).
 */
const DATABENTO_FUTURES_SYMBOLS = new Set(["GC", "ES", "NQ"]);

const fixtureProvider = new FixtureMarketDataProvider();
const databentoProvider = new DatabentoHistoricalMarketDataProvider();

/**
 * Stage 17B §16/§20 — licensing guard. Even with `DATABENTO_API_KEY`
 * configured and the adapter working end-to-end, real Databento-backed data
 * must NOT reach general production users until Databento's
 * redistribution/display terms are explicitly confirmed for this use case
 * (Stage 17A flagged licensing as the recurring blocker across every
 * vendor). Defaults to `false` — an absent/unset env var is "not yet
 * confirmed," never treated as an implicit yes. Flip to `"true"` only after
 * that confirmation.
 */
export function isMarketDataExternalDisplayEnabled(): boolean {
  return process.env.MARKET_DATA_EXTERNAL_DISPLAY_ENABLED === "true";
}

/**
 * Market-data provider selection (Stage 13 §7, extended Stage 17B §12) —
 * futures (GC/ES/NQ, and their MGC/MES/MNQ aliases via the instrument
 * catalog) resolve to Databento when it's configured
 * (`DATABENTO_API_KEY` set); everything else, and futures when Databento
 * isn't configured, falls back to `FixtureMarketDataProvider` — exactly the
 * same "gated on isAvailable(), else Null/dev fallback" pattern as
 * `resolveRecognitionProvider` (trade-plan.service.ts)'s Claude/Null choice.
 * Deliberately NOT session-aware: freeze-once behavior (never silently
 * switching providers mid-session even if this function's answer changes
 * later) is enforced one layer up, in `replay-review.service.ts`'s
 * provenance freezing — see that file's own doc comment.
 */
export function resolveMarketDataProvider(canonicalSymbol: string): HistoricalMarketDataProvider {
  if (
    DATABENTO_FUTURES_SYMBOLS.has(canonicalSymbol.toUpperCase()) &&
    databentoProvider.isAvailable() &&
    isMarketDataExternalDisplayEnabled()
  ) {
    return databentoProvider;
  }
  return fixtureProvider;
}

/** Looks a provider up BY ID regardless of current config/availability —
 *  used only to honor freeze-once provenance (Stage 17B §13): a session
 *  that already recorded "databento" for an asset must keep asking
 *  Databento, even if `resolveMarketDataProvider` would answer differently
 *  today, and must surface a clear error rather than silently falling back
 *  to Fixture if that provider becomes unavailable mid-session. */
export function getProviderById(providerId: string): HistoricalMarketDataProvider | null {
  if (providerId === databentoProvider.id) return databentoProvider;
  if (providerId === fixtureProvider.id) return fixtureProvider;
  return null;
}

const DAY_MS = 86_400_000;

/**
 * Historical candle cache (Stage 13 §8) — an in-memory, per-process, per-UTC-
 * day cache. Deliberately NOT a Postgres table: Replay references market
 * data by (symbol, timeframe, time), it never owns or duplicates a candle
 * dataset (see ReplayReviewSession's own doc comment) — there is no
 * "genuine relationship to persist" yet that would justify a migration. A
 * persistent cache table is a reasonable future step once a paid provider's
 * latency/rate limits make per-process memory insufficient. (Stage 17B adds
 * a separate, OPT-IN, durable L2 cache for real vendor data — see
 * market-data-cache.ts — which this L1 sits in front of.)
 */
const dayCache = new Map<string, { candles: Candle[]; provenance?: CandleProvenance }>();

function cacheKey(providerId: string, canonicalSymbol: string, dayStartMs: number): string {
  return `${providerId}:${canonicalSymbol}:${dayStartMs}`;
}

export interface HistoricalCandlesResult {
  ok: true;
  candles: Candle[];
  /** One provenance record per distinct UTC day chunk actually fetched from
   *  the provider during this call (§11) — a multi-day request can span a
   *  rollover, so this is never collapsed to a single record. Days served
   *  entirely from the (already-provenance-tagged) L1/L2 cache still
   *  contribute their originally-recorded provenance here. */
  provenance: CandleProvenance[];
}

/**
 * Fetches base-timeframe candles for [from, to] (UTC ms, inclusive),
 * chunked and cached by UTC calendar day so repeated Replay navigation
 * within an already-fetched day never re-hits the provider. Callers
 * aggregate the result to a coarser canonical Timeframe themselves via
 * domain/market-data/aggregation.ts — this function only ever returns the
 * provider's own base series.
 *
 * `providerOverride` exists solely for freeze-once (Stage 17B §13): once a
 * session has recorded provenance for an asset, the caller passes that
 * exact provider back in rather than re-resolving from current config.
 */
export async function getHistoricalCandles(
  canonicalSymbol: string,
  from: number,
  to: number,
  providerOverride?: HistoricalMarketDataProvider,
): Promise<HistoricalCandlesResult | Extract<FetchCandlesResult, { ok: false }>> {
  const provider = providerOverride ?? resolveMarketDataProvider(canonicalSymbol);
  const resolution = provider.resolveSymbol(canonicalSymbol);
  if (!resolution.supported) {
    return { ok: false, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown instrument: ${canonicalSymbol}` } };
  }
  if (from > to) {
    return { ok: false, error: { code: "PROVIDER_ERROR", message: "from must be <= to." } };
  }

  const firstDay = Math.floor(from / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(to / DAY_MS) * DAY_MS;
  const allCandles: Candle[] = [];
  const provenance: CandleProvenance[] = [];

  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const key = cacheKey(provider.id, canonicalSymbol, day);
    let entry = dayCache.get(key);
    if (!entry) {
      const result = await provider.fetchCandles({ canonicalSymbol, from: day, to: day + DAY_MS - 1 });
      if (!result.ok) return result;
      entry = { candles: result.candles, provenance: result.provenance };
      dayCache.set(key, entry);
    }
    allCandles.push(...entry.candles);
    if (entry.provenance) provenance.push(entry.provenance);
  }

  return { ok: true, candles: allCandles.filter((c) => c.timestamp >= from && c.timestamp <= to), provenance };
}

export function getMarketDataProviderInfo(canonicalSymbol: string): { id: string; displayName: string; baseTimeframe: string } {
  const provider = resolveMarketDataProvider(canonicalSymbol);
  return { id: provider.id, displayName: provider.displayName, baseTimeframe: provider.baseTimeframe };
}
