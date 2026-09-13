/**
 * Development-safe market-data adapter (Stage 13 §7) — a deterministic,
 * seeded synthetic candle generator. No network call, no API key, no vendor
 * decision made on the trader's behalf. `isAvailable()` always returns true
 * so Replay can be built and tested end-to-end before any production
 * provider is chosen (see market-data.service.ts's `resolveMarketDataProvider`
 * and this stage's completion report for which real vendors would fit this
 * same interface later).
 *
 * Same-seed-same-output for a given (symbol, UTC day): a weekend (UTC
 * Sat/Sun) produces NO candles at all — a genuine, realistic gap for
 * Replay's gap-handling logic to skip over, never fabricated data.
 */
import { lookupInstrument, parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import type { Candle } from "@/domain/market-data/candle";
import type {
  FetchCandlesParams,
  FetchCandlesResult,
  HistoricalMarketDataProvider,
  ProviderSymbolResolution,
} from "@/domain/market-data/provider-types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A tiny deterministic PRNG (mulberry32) — no external dependency, no
 *  platform-specific Math.random seeding, identical output on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

function basePriceFor(canonicalSymbol: string): number {
  const spec = lookupInstrument(canonicalSymbol);
  if (!spec) return 100;
  switch (spec.assetClass) {
    case "FOREX":
      return 1.1;
    case "METALS":
      return 1950;
    case "INDEX":
      return 18000;
    case "FUTURES":
      return 5000;
    case "CRYPTO":
      return 60000;
    default:
      return 100;
  }
}

/** One UTC calendar day of 1-minute candles for `canonicalSymbol`, or an
 *  empty array on a UTC Saturday/Sunday (the deliberate weekend gap). */
function generateDay(canonicalSymbol: string, dayStartMs: number): Candle[] {
  const weekday = new Date(dayStartMs).getUTCDay();
  if (weekday === 0 || weekday === 6) return [];

  const rand = mulberry32(hashSeed(`${canonicalSymbol}:${dayStartMs}`));
  const spec = lookupInstrument(canonicalSymbol);
  const precision = spec?.decimalPrecision ?? 4;
  const step = basePriceFor(canonicalSymbol) * 0.00015;

  let price = basePriceFor(canonicalSymbol) + (rand() - 0.5) * step * 50;
  const candles: Candle[] = [];
  for (let m = 0; m < 1440; m += 1) {
    const open = price;
    const drift = (rand() - 0.5) * step;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + rand() * step * 0.5;
    const low = Math.min(open, close) - rand() * step * 0.5;
    price = close;
    const round = (v: number) => Number(v.toFixed(precision));
    candles.push({
      timestamp: dayStartMs + m * MINUTE_MS,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: spec?.assetClass === "FUTURES" ? Math.round(rand() * 500) : null,
    });
  }
  return candles;
}

export class FixtureMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "fixture";
  readonly displayName = "Fixture (synthetic, dev-only)";
  readonly baseTimeframe = "1m" as const;

  isAvailable(): boolean {
    return true;
  }

  resolveSymbol(canonicalSymbol: string): ProviderSymbolResolution {
    const spec = parseSymbol(canonicalSymbol).spec ?? lookupInstrument(canonicalSymbol);
    return {
      supported: spec != null,
      providerSymbol: spec ? spec.canonicalSymbol : null,
      priceBasis: "synthetic",
    };
  }

  getSupportedRange(canonicalSymbol: string): { from: number; to: number } | null {
    if (!this.resolveSymbol(canonicalSymbol).supported) return null;
    // Synthetic data "exists" for any date — a generous, obviously-fake range.
    return { from: Date.UTC(2015, 0, 1), to: Date.UTC(2035, 0, 1) };
  }

  async fetchCandles(params: FetchCandlesParams): Promise<FetchCandlesResult> {
    const resolution = this.resolveSymbol(params.canonicalSymbol);
    if (!resolution.supported) {
      return { ok: false, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown instrument: ${params.canonicalSymbol}` } };
    }
    if (params.from > params.to) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "from must be <= to." } };
    }

    const firstDay = Math.floor(params.from / DAY_MS) * DAY_MS;
    const lastDay = Math.floor(params.to / DAY_MS) * DAY_MS;
    const candles: Candle[] = [];
    for (let day = firstDay; day <= lastDay; day += DAY_MS) {
      for (const c of generateDay(params.canonicalSymbol, day)) {
        if (c.timestamp >= params.from && c.timestamp <= params.to) candles.push(c);
      }
    }
    return {
      ok: true,
      candles,
      provenance: {
        providerId: this.id,
        priceBasis: "synthetic",
        retrievedAt: new Date().toISOString(),
        segments: [{ contractSymbol: resolution.providerSymbol ?? params.canonicalSymbol, from: params.from, to: params.to }],
      },
    };
  }
}
