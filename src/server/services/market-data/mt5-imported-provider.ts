/**
 * Stage 21.3A §23 — `Mt5ImportedHistoricalMarketDataProvider`: implements
 * the EXACT SAME `HistoricalMarketDataProvider` interface Databento/Twelve
 * Data/Fixture already implement. Replay Clock, the execution engine, and
 * `aggregateCandles`/`visible-candles.ts` need zero changes to eventually
 * consume this — they only ever see a plain `Candle[]` (§2/§23).
 *
 * ARCHITECTURAL NOTE (documented, not silently worked around): imported
 * data is inherently USER-OWNED, but `HistoricalMarketDataProvider.
 * fetchCandles` takes no `userId` (Databento/Twelve Data are global vendor
 * feeds, correctly stateless in that respect). Rather than widen that
 * shared interface for one provider, this class takes `userId` at
 * CONSTRUCTION time — the caller (always inside an authenticated Replay
 * request, where the user is already known) constructs one instance per
 * user, exactly like `getProviderById`'s existing per-request resolution
 * pattern. This is the "smallest interface preparation necessary" Stage
 * 21.3A allows for — no change to `HistoricalMarketDataProvider` itself.
 *
 * NOT wired into `resolveMarketDataProvider`'s automatic dispatch yet
 * (Stage 21.3B decides the Data Source: MT5 Imported selector/UX) — this
 * class is proven correct in isolation this stage.
 */
import { findOverlappingMt5Imports, readMt5ImportCandles } from "@/server/services/mt5-import.service";
import type { Candle } from "@/domain/market-data/candle";
import type { CandleProvenance, FetchCandlesParams, FetchCandlesResult, HistoricalMarketDataProvider, ProviderSymbolResolution } from "@/domain/market-data/provider-types";
import type { Timeframe } from "@/domain/market-data/timeframe";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";

export class Mt5ImportedHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "mt5-imported";
  readonly displayName = "MT5 Imported";
  readonly baseTimeframe: Timeframe;

  constructor(
    private readonly userId: string,
    /** The native timeframe THIS instance serves — an MT5 import's own
     *  resolution is fixed per import; a caller wanting multiple imported
     *  timeframes for the same symbol constructs one instance per
     *  timeframe, mirroring how a real vendor provider has exactly one
     *  `baseTimeframe`. */
    baseTimeframe: Timeframe = "1m",
  ) {
    this.baseTimeframe = baseTimeframe;
  }

  isAvailable(): boolean {
    // Always "available" as a CLASS (no API key gate like a vendor) — real
    // availability for a specific symbol is what `resolveSymbol`/
    // `getSupportedRange` answer, since it depends on what THIS user has
    // actually imported.
    return true;
  }

  resolveSymbol(canonicalSymbol: string): ProviderSymbolResolution {
    const spec = lookupInstrument(canonicalSymbol);
    return { supported: spec != null, providerSymbol: spec?.canonicalSymbol ?? null, priceBasis: "user-imported" };
  }

  /**
   * Unlike a vendor provider, this genuinely requires an async DB lookup —
   * `HistoricalMarketDataProvider.getSupportedRange` is synchronous, so
   * this always returns `null` (a legitimate, honest "coverage unknown
   * without asking" answer per the interface's own contract) rather than
   * a fabricated always-available range. Callers that need the real
   * imported range should use `findOverlappingMt5Imports` directly, or a
   * future async extension point — this is the ONE place the current
   * interface's synchronous shape doesn't fully fit an imported-data
   * provider, documented here rather than silently worked around.
   */
  getSupportedRange(): { from: number; to: number } | null {
    return null;
  }

  async fetchCandles(params: FetchCandlesParams): Promise<FetchCandlesResult> {
    if (params.from > params.to) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "from must be <= to." } };
    }
    const resolution = this.resolveSymbol(params.canonicalSymbol);
    if (!resolution.supported) {
      return { ok: false, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown instrument: ${params.canonicalSymbol}` } };
    }

    const imports = await findOverlappingMt5Imports(this.userId, params.canonicalSymbol, this.baseTimeframe, params.from, params.to);
    if (imports.length === 0) {
      return { ok: false, error: { code: "OUT_OF_COVERAGE", message: `No imported ${this.baseTimeframe} data for ${params.canonicalSymbol} in this range.` } };
    }

    // §22 — newest import wins for an overlapping instant. `imports` is
    // already newest-first; a candle already claimed by a newer import is
    // never overwritten by an older one for the SAME timestamp, but an
    // older import can still fill a range the newer one doesn't cover.
    const byTimestamp = new Map<number, Candle>();
    for (const imp of imports) {
      const candles = await readMt5ImportCandles(this.userId, imp.id, params.from, params.to);
      for (const c of candles) if (!byTimestamp.has(c.timestamp)) byTimestamp.set(c.timestamp, c);
    }
    const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);

    const provenance: CandleProvenance = {
      providerId: this.id,
      priceBasis: "user-imported",
      retrievedAt: new Date().toISOString(),
      // `contractSymbol` is a free-text field on every other provider too
      // (§ provider-types.ts) — reused here to carry the CONTRIBUTING
      // import id(s), never a fabricated "contract." §24: Candle Trace can
      // resolve these ids back to their own `MarketDataImport` row for
      // full "Provider: MT5 Imported, imported by <user> on <date>" detail.
      segments: imports.map((imp) => ({ contractSymbol: imp.id, from: params.from, to: params.to })),
    };

    return { ok: true, candles, provenance };
  }
}
