/**
 * Provider-agnostic historical market-data abstraction (Stage 13 §2/§7).
 * Traditorium's Replay engine is never hard-coded to one vendor — every
 * concrete adapter (the fixture provider today; a real vendor later)
 * implements this same interface. Mirrors this codebase's existing
 * `ScreenshotRecognitionProvider` pattern (domain/trade-plan/recognition-
 * types.ts): a small interface + an `isAvailable()` capability check + a
 * `resolveXProvider()` picker in the service layer.
 */
import type { Candle } from "@/domain/market-data/candle";
import type { Timeframe } from "@/domain/market-data/timeframe";

export interface ProviderSymbolResolution {
  supported: boolean;
  /** The provider's own ticker string for this canonical symbol — never
   *  leaked past the adapter boundary into Replay components (§4). For a
   *  futures provider this is typically a CONTINUOUS symbol (e.g.
   *  "ES.v.0"), not a literal dated contract — see `contractSymbol`. */
  providerSymbol: string | null;
  /**
   * Stage 17B §6 — the literal, dated contract symbol (e.g. "ESZ6") this
   * resolution currently points at, when the provider deals in dated
   * futures contracts and a single unambiguous one applies. Left
   * undefined for providers with no such concept (Fixture) or when the
   * true answer depends on the requested date range spanning a rollover
   * (see `CandleProvenance.segments` on `FetchCandlesResult` instead —
   * that is the authoritative multi-segment answer; this field is only a
   * best-effort single-symbol hint for callers that don't need segments).
   */
  contractSymbol?: string;
  /** Stage 17B §6 — a short label for how prices are expressed, e.g.
   *  "raw-unadjusted" (literal historical contract, no back-adjustment) or
   *  "synthetic" (Fixture). Informational only; never used for math. */
  priceBasis?: string;
}

/**
 * Stage 17B §11 — one literal historical contract's coverage within a
 * `fetchCandles` result. A single call can span a rollover, so this is
 * always an array, never a single symbol — see `CandleProvenance`'s own
 * doc comment for why this must never be collapsed to "the" contract.
 */
export interface CandleProvenanceSegment {
  /** The literal, dated contract symbol these candles actually came from
   *  (e.g. "ESZ6"), never a continuous/back-adjusted series (§9). */
  contractSymbol: string;
  /** UTC ms, inclusive — the portion of the requested range this segment covers. */
  from: number;
  to: number;
}

/**
 * Stage 17B §11 — market-data provenance: which provider, which literal
 * contract(s), and when it was fetched. Frozen once per (session, asset) by
 * the caller (replay-review.service.ts) — this type only describes the
 * shape a provider hands back per `fetchCandles` call; freeze-once
 * enforcement lives above the provider boundary, not here.
 */
export interface CandleProvenance {
  /** Matches `HistoricalMarketDataProvider.id` (e.g. "databento", "fixture"). */
  providerId: string;
  /** The vendor dataset these candles were sourced from, e.g. "GLBX.MDP3". Undefined for providers with no dataset concept. */
  datasetId?: string;
  /** See `ProviderSymbolResolution.priceBasis`. */
  priceBasis?: string;
  /** ISO 8601 — when this specific fetch happened (not when the underlying market data was recorded). */
  retrievedAt: string;
  /** One or more literal contracts this result's candles were drawn from,
   *  in ascending time order. Always non-empty when present. */
  segments: CandleProvenanceSegment[];
}

export type MarketDataErrorCode =
  | "UNSUPPORTED_SYMBOL"
  | "UNSUPPORTED_TIMEFRAME"
  | "OUT_OF_COVERAGE"
  | "PROVIDER_ERROR";

export interface MarketDataError {
  code: MarketDataErrorCode;
  message: string;
}

export interface FetchCandlesParams {
  canonicalSymbol: string;
  /** UTC ms, inclusive range. */
  from: number;
  to: number;
}

export type FetchCandlesResult =
  | { ok: true; candles: Candle[]; provenance?: CandleProvenance }
  | { ok: false; error: MarketDataError };

export interface HistoricalMarketDataProvider {
  id: string;
  displayName: string;
  /** Gated on config (API key/account) exactly like ClaudeVisionRecognitionProvider — never assumed available. */
  isAvailable(): boolean;
  /** The finest timeframe this provider natively returns; Traditorium derives
   *  every coarser canonical timeframe from it via aggregation.ts (§6). */
  baseTimeframe: Timeframe;
  resolveSymbol(canonicalSymbol: string): ProviderSymbolResolution;
  /** Null when the symbol is entirely unsupported; otherwise the provider's
   *  known historical coverage window (UTC ms) for that symbol. */
  getSupportedRange(canonicalSymbol: string): { from: number; to: number } | null;
  fetchCandles(params: FetchCandlesParams): Promise<FetchCandlesResult>;
}
