import { FixtureMarketDataProvider } from "@/domain/market-data/providers/fixture-provider";
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { DatabentoHistoricalMarketDataProvider } from "@/server/services/market-data/databento-provider";
import { TwelveDataHistoricalMarketDataProvider } from "@/server/services/market-data/twelve-data-provider";
import type { Candle } from "@/domain/market-data/candle";
import type { CandleProvenance, FetchCandlesResult, HistoricalMarketDataProvider } from "@/domain/market-data/provider-types";

/**
 * Canonical futures symbols Databento is the production candidate for
 * (Stage 17B, corrected Stage 17B.1 §1/§8). Everything else (forex, XAUUSD,
 * indices) stays on Fixture until a Stage 17C provider is chosen — this
 * list is intentionally NOT "every FUTURES-class instrument in the
 * catalog," only the ones this stage's adapter actually resolves. All SIX
 * are listed independently — MGC/MES/MNQ are NOT aliases of GC/ES/NQ (see
 * `instrument-catalog.ts` and `databento-provider.ts`'s own doc comments):
 * each fetches its own literal exchange contract.
 */
const DATABENTO_FUTURES_SYMBOLS = new Set(["GC", "MGC", "ES", "MES", "NQ", "MNQ"]);

/**
 * Canonical OTC symbols Twelve Data is the production candidate for
 * (Stage 17C.2 §7/§19) — exactly the five symbols
 * `twelve-data-provider.ts` actually resolves (see that module's own
 * `CANONICAL_TO_TWELVE_DATA_SYMBOL` map). Deliberately does NOT include any
 * INDEX/CFD symbol (NAS100, US500, etc.) — Stage 17C.1 did not confirm
 * Twelve Data's exact index symbol semantics, and this stage's spec is
 * explicit: no speculative mappings. It also never maps an INDEX/CFD
 * canonical symbol onto a FUTURES canonical symbol or vice versa (Stage
 * 17B.1's identity lesson, restated Stage 17C.2 §20) — NAS100 stays NAS100,
 * never becomes NQ futures data, and simply isn't in this set (or any
 * other provider's routing set) until a real OTC index source is chosen.
 */
const TWELVE_DATA_OTC_SYMBOLS = new Set(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"]);

const fixtureProvider = new FixtureMarketDataProvider();
const databentoProvider = new DatabentoHistoricalMarketDataProvider();
const twelveDataProvider = new TwelveDataHistoricalMarketDataProvider();

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
 * Stage 17C.2 §6 — Twelve Data's OWN, INDEPENDENT licensing guard, gated by
 * its own explicit env var rather than sharing `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED`.
 * Databento and Twelve Data are separate vendors under separate commercial
 * agreements (Stage 17C.1) — confirming/enabling one vendor's
 * redistribution terms must never implicitly enable the other's. Defaults
 * to `false`, same "absent means not yet confirmed" discipline as the
 * Databento flag.
 */
export function isTwelveDataExternalDisplayEnabled(): boolean {
  return process.env.TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED === "true";
}

/**
 * Stage 17B.1 §10 — an explicit, non-production-only escape hatch for a
 * developer who needs to exercise the Databento path locally without
 * flipping the production-facing licensing flag. Requires BOTH an explicit
 * opt-in env var AND a non-production `NODE_ENV`, so it can never be
 * accidentally left on in a deployed environment. Defaults to false.
 */
function isMarketDataDisplayDevOverrideEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE === "true";
}

/**
 * Stage 17B.1 §10/§11 — CURRENT permission to display/fetch a given
 * provider's data, independent of whether a session already froze that
 * provider's provenance. Historical provenance (§10 "Historical
 * provenance") must remain immutable forever; this function answers the
 * SEPARATE question "is licensed display currently permitted?" for
 * whichever provider a session is pinned to. Fixture is always permitted
 * (no licensing concern — synthetic data). Databento is permitted only when
 * `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED=true`, or the explicit dev override
 * above — never merely because a session's provenance already names it.
 */
export function isProviderDisplayPermitted(providerId: string): boolean {
  if (providerId === fixtureProvider.id) return true;
  if (providerId === databentoProvider.id) {
    return isMarketDataExternalDisplayEnabled() || isMarketDataDisplayDevOverrideEnabled();
  }
  if (providerId === twelveDataProvider.id) {
    return isTwelveDataExternalDisplayEnabled() || isMarketDataDisplayDevOverrideEnabled();
  }
  return false;
}

/**
 * Market-data provider selection (Stage 13 §7, extended Stage 17B §12,
 * corrected Stage 17B.1 §1, extended Stage 17C.2 §19) — the six distinct
 * futures identities GC, MGC, ES, MES, NQ, MNQ (each its own
 * `canonicalSymbol`, never collapsed onto a sibling) resolve to Databento
 * when it's configured AND currently permitted for display
 * (`isProviderDisplayPermitted`); the five OTC identities EURUSD, GBPUSD,
 * USDJPY, XAUUSD, XAGUSD resolve to Twelve Data under the exact same
 * "configured AND permitted" gate, independently of Databento's; everything
 * else — including any INDEX/CFD symbol, never bridged onto futures data
 * (§20) — falls back to `FixtureMarketDataProvider`. Exactly the same
 * "gated on isAvailable(), else Null/dev fallback" pattern as
 * `resolveRecognitionProvider` (trade-plan.service.ts)'s Claude/Null
 * choice. Deliberately NOT session-aware: freeze-once behavior (never
 * silently switching providers mid-session even if this function's answer
 * changes later) is enforced one layer up, in
 * `replay-review.service.ts`'s provenance freezing — see that file's own
 * doc comment.
 */
export function resolveMarketDataProvider(canonicalSymbol: string): HistoricalMarketDataProvider {
  const upper = canonicalSymbol.toUpperCase();
  if (DATABENTO_FUTURES_SYMBOLS.has(upper) && databentoProvider.isAvailable() && isProviderDisplayPermitted(databentoProvider.id)) {
    return databentoProvider;
  }
  // Stage 17C.2 §9/§34 — normalize a possibly broker-suffixed raw symbol
  // ("XAUUSD.a") to its canonical form before testing OTC routing
  // eligibility, so a broker-cosmetic suffix doesn't silently fall through
  // to Fixture. Never used to bridge one distinct instrument onto another
  // (§20) — `parseSymbol` only ever strips a cosmetic wrapper around an
  // already-known catalog symbol (see `instrument-catalog.ts`).
  const otcCanonical = parseSymbol(canonicalSymbol).spec?.canonicalSymbol ?? upper;
  if (TWELVE_DATA_OTC_SYMBOLS.has(otcCanonical) && twelveDataProvider.isAvailable() && isProviderDisplayPermitted(twelveDataProvider.id)) {
    return twelveDataProvider;
  }
  return fixtureProvider;
}

/** Looks a provider up BY ID regardless of current config/availability —
 *  used only to honor freeze-once provenance (Stage 17B §13): a session
 *  that already recorded a provider for an asset must keep asking that same
 *  provider, even if `resolveMarketDataProvider` would answer differently
 *  today, and must surface a clear error rather than silently falling back
 *  to Fixture if that provider becomes unavailable mid-session. */
export function getProviderById(providerId: string): HistoricalMarketDataProvider | null {
  if (providerId === databentoProvider.id) return databentoProvider;
  if (providerId === twelveDataProvider.id) return twelveDataProvider;
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

/**
 * Stage 17D §15 — concurrent-request dedup. `dayCache` above only helps
 * once a fetch has RESOLVED; a naive "miss? then fetch" check-then-act has
 * a race: two callers can both see a miss for the same (provider, symbol,
 * day) before either's `provider.fetchCandles` resolves, and both would
 * hit the real provider — wasting a real HTTP call (and, for a
 * credit-metered vendor like Twelve Data, real money) for data one of them
 * is already fetching. This is a genuine production concern, not just an
 * internal race: two different users opening a Replay session for the same
 * popular asset/day at the same moment is an ordinary occurrence, not an
 * edge case. This map holds the IN-FLIGHT promise per key so every
 * concurrent caller for the same day awaits the SAME single provider call
 * instead of issuing their own. Deliberately per-process, in-memory only —
 * no distributed locking, no Redis, no cross-instance coordination; that
 * would be solving a problem this deployment doesn't have yet (Stage 17B's
 * L1 cache is already documented as per-process for the same reason).
 */
const inFlightFetches = new Map<string, Promise<FetchCandlesResult>>();

function cacheKey(providerId: string, canonicalSymbol: string, dayStartMs: number): string {
  return `${providerId}:${canonicalSymbol}:${dayStartMs}`;
}

/** Fetches one UTC day from the provider, deduplicating concurrent callers
 *  for the exact same key onto a single in-flight promise. */
function fetchDayDeduped(provider: HistoricalMarketDataProvider, canonicalSymbol: string, day: number): Promise<FetchCandlesResult> {
  const key = cacheKey(provider.id, canonicalSymbol, day);
  const existing = inFlightFetches.get(key);
  if (existing) return existing;

  const promise = provider
    .fetchCandles({ canonicalSymbol, from: day, to: day + DAY_MS - 1 })
    .finally(() => inFlightFetches.delete(key));
  inFlightFetches.set(key, promise);
  return promise;
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
      const result = await fetchDayDeduped(provider, canonicalSymbol, day);
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
