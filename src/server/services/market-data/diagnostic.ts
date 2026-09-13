/**
 * Stage 17D §12 — a small, development-only diagnostic for visually/
 * numerically inspecting what a market-data provider actually returns for
 * a bounded window: timestamp, OHLCV, provider id, canonical + provider
 * symbol, literal contract (futures) or provider symbol (OTC), and price
 * basis. Exists purely to help a developer eyeball real candles during
 * Stage 17D's live-verification checklist (§5-8, §11) — NOT a user-facing
 * feature, never imported from a "use client" file or exposed via a route.
 * Deliberately thin: reuses the existing `getProviderById`/provider
 * abstraction rather than duplicating any fetch/parse/cache logic, and
 * caps the window itself (`MAX_DIAGNOSTIC_CANDLES`) so this can never turn
 * into an ad-hoc bulk data-export tool.
 */
import type { Candle } from "@/domain/market-data/candle";
import { getProviderById } from "@/server/services/market-data.service";
import type { CandleProvenance } from "@/domain/market-data/provider-types";

const MAX_DIAGNOSTIC_CANDLES = 2000; // one generous UTC day's worth of 1m bars, never a bulk export

export interface DiagnosticRow {
  timestamp: string; // ISO 8601, UTC — human-readable in a printed table
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  provider: string;
  canonicalSymbol: string;
  providerSymbol: string | null;
  contract: string | null; // literal contract (Databento) or provider symbol (OTC, no separate contract concept)
  priceBasis: string | null;
}

export interface DiagnosticResult {
  ok: true;
  rows: DiagnosticRow[];
  provenance: CandleProvenance[];
  truncated: boolean;
}

export interface DiagnosticError {
  ok: false;
  error: string;
}

function toRows(candles: Candle[], providerId: string, canonicalSymbol: string, providerSymbol: string | null, provenance: CandleProvenance[]): DiagnosticRow[] {
  return candles.map((c) => {
    // Find the provenance segment covering this candle's timestamp, if any — gives the exact literal contract/basis for THIS bar.
    const segment = provenance.flatMap((p) => p.segments.map((s) => ({ ...s, priceBasis: p.priceBasis }))).find((s) => c.timestamp >= s.from && c.timestamp <= s.to);
    return {
      timestamp: new Date(c.timestamp).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      provider: providerId,
      canonicalSymbol,
      providerSymbol,
      contract: segment?.contractSymbol ?? null,
      priceBasis: segment?.priceBasis ?? null,
    };
  });
}

/**
 * Fetches and shapes a bounded sample for manual inspection. Goes through
 * the provider's OWN `fetchCandles` directly (not the L1/L2 cache-wrapped
 * `getHistoricalCandles`) so a diagnostic run always reflects a fresh,
 * uncached provider response — exactly what a developer verifying live
 * data wants, and it never pollutes the shared process cache with
 * diagnostic-only fetches.
 */
export async function dumpMarketDataSample(params: {
  providerId: string;
  canonicalSymbol: string;
  fromMs: number;
  toMs: number;
}): Promise<DiagnosticResult | DiagnosticError> {
  const provider = getProviderById(params.providerId);
  if (!provider) return { ok: false, error: `Unknown provider id: ${params.providerId}` };
  if (!provider.isAvailable()) return { ok: false, error: `${provider.displayName} is not configured (missing API key).` };
  if (params.fromMs > params.toMs) return { ok: false, error: "fromMs must be <= toMs." };

  const resolution = provider.resolveSymbol(params.canonicalSymbol);
  if (!resolution.supported) return { ok: false, error: `${provider.displayName} does not support ${params.canonicalSymbol}.` };

  const result = await provider.fetchCandles({ canonicalSymbol: params.canonicalSymbol, from: params.fromMs, to: params.toMs });
  if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };

  const truncated = result.candles.length > MAX_DIAGNOSTIC_CANDLES;
  const bounded = truncated ? result.candles.slice(0, MAX_DIAGNOSTIC_CANDLES) : result.candles;
  const provenance = result.provenance ? [result.provenance] : [];

  return {
    ok: true,
    rows: toRows(bounded, provider.id, params.canonicalSymbol, resolution.providerSymbol, provenance),
    provenance,
    truncated,
  };
}

/** Renders rows as a plain-text table for console inspection — no chart, no export file, no UI. */
export function formatDiagnosticTable(rows: DiagnosticRow[]): string {
  const header = "timestamp                 open       high       low        close      volume   provider    symbol    contract     basis";
  const lines = rows.map((r) =>
    [
      r.timestamp,
      r.open.toFixed(5).padStart(10),
      r.high.toFixed(5).padStart(10),
      r.low.toFixed(5).padStart(10),
      r.close.toFixed(5).padStart(10),
      String(r.volume ?? "-").padStart(8),
      r.provider.padStart(11),
      r.canonicalSymbol.padStart(9),
      (r.contract ?? "-").padStart(12),
      (r.priceBasis ?? "-").padStart(12),
    ].join("  "),
  );
  return [header, ...lines].join("\n");
}
