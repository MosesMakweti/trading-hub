/**
 * Databento Historical HTTP API adapter — Stage 17B. The first REAL
 * `HistoricalMarketDataProvider`: literal, dated CME/CBOT/COMEX/NYMEX
 * futures contracts, never a back-adjusted continuous series (§9). Every
 * request is server-side only (this module must never be imported from a
 * "use client" file) and gated on `DATABENTO_API_KEY` — never
 * `NEXT_PUBLIC_*` (§3).
 *
 * ## What's confirmed vs. assumed (Stage 17B §2)
 *
 * Databento's docs site (databento.com/docs/...) is heavily JS-rendered and
 * could not be fetched as plain text during this stage — the following was
 * confirmed instead via `databento-python`'s plain-markdown README and
 * targeted search-engine results, cross-checked against Stage 17A's own
 * research. CONFIRMED: base URL, HTTP Basic Auth (API key as username,
 * empty password), `timeseries.get_range` params (`dataset`, `symbols`,
 * `schema`, `stype_in`, `stype_out`, `encoding`, `start`/`end` — start
 * inclusive, end EXCLUSIVE), the `{root}.{c|v|n}.{rank}` continuous-symbol
 * format (raw/unadjusted, never back-adjusted), the `ohlcv-1m` schema name,
 * price scaling (fixed-point integer × 1e-9 unless `pretty_px=true`), and —
 * critically for §17 — that `ts_event` is the bar's OPEN/start time
 * (matches `Candle.timestamp` exactly, no shift). CONFIRMED via
 * `symbology.resolve`'s documented example response shape:
 * `{result: {[symbol]: [{d0, d1, s}, ...]}}`, `d0`/`d1` the segment's
 * effective start/end dates.
 *
 * ASSUMED (could not be verified without a live API key — treated as an
 * acceptable open item per §37, "Live Databento verification pending API
 * key"): the exact OHLCV JSON field names beyond `ts_event` (`open`/`high`/
 * `low`/`close`/`volume` — extremely likely for a schema literally named
 * "ohlcv-1m", but not independently confirmed field-by-field); that
 * `timeseries.get_range`'s JSON encoding is newline-delimited (one record
 * per line) rather than a single JSON array — this adapter's parser accepts
 * BOTH shapes defensively; whether `pretty_ts`/`pretty_px` are honored by
 * `timeseries.get_range` specifically (confirmed only for `batch.submit_job`
 * in available sources) — this adapter requests both AND independently
 * parses `ts_event`/prices defensively (ISO string, or raw fixed-point
 * integer, whichever comes back — see `parseTsEventToMs`/`parsePrice`);
 * exact rate-limit numbers and pagination behavior for very large ranges —
 * mitigated by this adapter always requesting at most one literal
 * contract's ONE UTC day at a time (matches `market-data.service.ts`'s
 * existing day-chunked cache granularity), never a whole multi-week range
 * in one call. Whether `symbology.resolve`'s `d1` is inclusive or exclusive
 * of that end date is not explicitly stated in the sources found; this
 * adapter treats it as EXCLUSIVE (consistent with `timeseries.get_range`'s
 * own confirmed start-inclusive/end-exclusive convention) and documents
 * that choice here rather than guessing silently.
 */
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";
import type { Candle } from "@/domain/market-data/candle";
import { isValidCandle, compareCandles } from "@/domain/market-data/candle";
import { isDayFullyClosed, readCachedDay, writeCachedDay } from "@/server/services/market-data-cache";
import type {
  CandleProvenance,
  CandleProvenanceSegment,
  FetchCandlesParams,
  FetchCandlesResult,
  HistoricalMarketDataProvider,
  ProviderSymbolResolution,
} from "@/domain/market-data/provider-types";

const HIST_BASE_URL = "https://hist.databento.com/v0";
export const DATABENTO_DATASET = "GLBX.MDP3";
const DAY_MS = 86_400_000;

/**
 * Canonical futures symbol → Databento root symbol. Deliberately only the
 * THREE distinct canonical roots that exist in Traditorium's own instrument
 * catalog for this stage's required list — see this module's top-level doc
 * comment and the Stage 17B completion report for why "MGC, GC, MES, ES,
 * MNQ, NQ" (six strings in the stage prompt) collapses to three canonical
 * symbols here: `instrument-catalog.ts`'s ALIASES table already canonicalizes
 * MES→ES and MNQ→NQ (same underlying price series, differ only in contract
 * size/tick value), and this stage adds the missing symmetric MGC→GC alias.
 * A trade/plan/session tagged with any of the six always resolves to one of
 * these three canonical symbols before it ever reaches this provider.
 */
const FUTURES_ROOT_BY_CANONICAL: Record<string, string> = {
  GC: "GC",
  ES: "ES",
  NQ: "NQ",
};

/**
 * Rollover policy (Stage 17B §10) — VOLUME-based continuous symbology
 * (`{root}.v.0`), not calendar (`.c.0`) or open-interest (`.n.0`). Volume is
 * the most faithful proxy for "where the market's actual liquidity already
 * moved to," which is what a Replay trader would have been filling against;
 * calendar rollover is blind to real liquidity and open-interest lags
 * during rollover week (a bulk of positions can still sit in the expiring
 * contract days after volume has already flipped). Rank 0 = front month.
 * This is a deliberate, documented choice, not a default left un-inspected.
 */
function continuousSymbolFor(root: string): string {
  return `${root}.v.0`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateStringToUtcMs(dateStr: string): number {
  return Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
}

/** Parses `ts_event` whether Databento returned an ISO 8601 string
 *  (`pretty_ts=true` honored) or a raw nanosecond-since-epoch integer/string
 *  (not honored) — a plain JSON number that large would already have lost
 *  precision by the time it reached us, so a numeric value is only trusted
 *  when it's still within `Number.isSafeInteger` range; anything else must
 *  arrive as a string so we can route it through `BigInt`. */
function parseTsEventToMs(raw: unknown): number | null {
  if (typeof raw === "string") {
    const iso = Date.parse(raw);
    if (!Number.isNaN(iso)) return iso;
    try {
      return Number(BigInt(raw) / BigInt(1_000_000));
    } catch {
      return null;
    }
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // A JSON number this large already lost sub-ms precision, but treat it
    // as best-effort nanoseconds since epoch rather than silently discarding it.
    return Math.round(raw / 1e6);
  }
  return null;
}

/** Parses a price field whether `pretty_px=true` was honored (decimal
 *  string/number) or not (fixed-point integer × 1e-9). */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: a genuine instrument price for these futures never
    // reaches 1e6; a fixed-point-scaled integer routinely does.
    return Math.abs(raw) > 1_000_000 ? raw / 1e9 : raw;
  }
  return null;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

class DatabentoHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Bounded retry/backoff for TRANSIENT failures only (429/5xx/network) —
 *  never for 4xx (bad request, auth, not-found), which retrying can't fix. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 300): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const transient =
        error instanceof DatabentoHttpError ? error.status === 429 || error.status >= 500 : true;
      if (!transient || attempt >= retries) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

async function databentoGet(path: string, params: Record<string, string>, apiKey: string): Promise<string> {
  const url = new URL(`${HIST_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  return withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: authHeader(apiKey) },
      });
    } catch (error) {
      throw new DatabentoHttpError(0, `Network error contacting Databento: ${(error as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new DatabentoHttpError(res.status, `Databento ${path} responded ${res.status}: ${text.slice(0, 500)}`);
    }
    return text;
  });
}

interface ResolvedSegment {
  contractSymbol: string;
  from: number;
  to: number;
}

/**
 * Time-aware contract resolution (Stage 17B §7/§8/§10) — resolves the
 * continuous symbol via `symbology.resolve` rather than a handwritten
 * rollover calendar, returning one-or-more literal dated contracts covering
 * `[fromMs, toMs]`. A range crossing a roll boundary comes back as multiple
 * segments; the caller must never assume exactly one.
 */
export async function resolveContract(
  canonicalSymbol: string,
  fromMs: number,
  toMs: number,
  apiKey: string,
): Promise<ResolvedSegment[]> {
  const root = FUTURES_ROOT_BY_CANONICAL[canonicalSymbol.toUpperCase()];
  if (!root) return [];

  const continuous = continuousSymbolFor(root);
  const text = await databentoGet(
    "/symbology.resolve",
    {
      dataset: DATABENTO_DATASET,
      symbols: continuous,
      stype_in: "continuous",
      stype_out: "raw_symbol",
      start_date: isoDate(fromMs),
      end_date: isoDate(toMs + DAY_MS), // end exclusive — cover the last requested day fully
    },
    apiKey,
  );

  let parsed: { result?: Record<string, { d0: string; d1: string; s: string }[]> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DatabentoHttpError(502, "Unrecognized symbology.resolve response (not valid JSON).");
  }
  const rows = parsed.result?.[continuous] ?? [];

  const segments: ResolvedSegment[] = [];
  for (const row of rows) {
    const segFrom = Math.max(fromMs, dateStringToUtcMs(row.d0));
    // d1 treated as EXCLUSIVE — see this module's top-level doc comment.
    const segTo = Math.min(toMs, dateStringToUtcMs(row.d1) - 1);
    if (segFrom > segTo) continue;
    segments.push({ contractSymbol: row.s, from: segFrom, to: segTo });
  }
  segments.sort((a, b) => a.from - b.from);
  return segments;
}

interface OhlcvRecord {
  ts_event: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}

/** Accepts either a JSON array of records or newline-delimited JSON — see
 *  this module's top-level doc comment on why both are handled defensively. */
function parseOhlcvResponse(text: string): OhlcvRecord[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  const records: OhlcvRecord[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l.length === 0) continue;
    try {
      records.push(JSON.parse(l));
    } catch {
      // Skip an unparseable line rather than fail the whole day's fetch —
      // gaps are preserved (never fabricated), just not silently masked
      // either; a corrupt line is simply a missing candle.
    }
  }
  return records;
}

function recordsToCandles(records: OhlcvRecord[]): Candle[] {
  const candles: Candle[] = [];
  for (const r of records) {
    const timestamp = parseTsEventToMs(r.ts_event);
    const open = parsePrice(r.open);
    const high = parsePrice(r.high);
    const low = parsePrice(r.low);
    const close = parsePrice(r.close);
    if (timestamp == null || open == null || high == null || low == null || close == null) continue;
    const volumeNum = typeof r.volume === "string" ? Number(r.volume) : typeof r.volume === "number" ? r.volume : null;
    const candle: Candle = { timestamp, open, high, low, close, volume: volumeNum != null && Number.isFinite(volumeNum) ? volumeNum : null };
    if (isValidCandle(candle)) candles.push(candle);
  }
  // Sort + dedup by timestamp (§13/§14) — never trust upstream ordering,
  // never fabricate a missing minute to fill a gap.
  candles.sort(compareCandles);
  const deduped: Candle[] = [];
  for (const c of candles) {
    if (deduped.length > 0 && deduped[deduped.length - 1].timestamp === c.timestamp) continue;
    deduped.push(c);
  }
  return deduped;
}

export class DatabentoHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "databento";
  readonly displayName = "Databento (CME/CBOT/NYMEX/COMEX futures)";
  readonly baseTimeframe = "1m" as const;

  private apiKey(): string | null {
    return process.env.DATABENTO_API_KEY || null;
  }

  isAvailable(): boolean {
    return this.apiKey() != null;
  }

  resolveSymbol(canonicalSymbol: string): ProviderSymbolResolution {
    const root = FUTURES_ROOT_BY_CANONICAL[canonicalSymbol.toUpperCase()];
    if (!root) return { supported: false, providerSymbol: null };
    return {
      supported: true,
      providerSymbol: continuousSymbolFor(root),
      priceBasis: "raw-unadjusted",
    };
  }

  getSupportedRange(canonicalSymbol: string): { from: number; to: number } | null {
    if (!this.resolveSymbol(canonicalSymbol).supported) return null;
    // GLBX.MDP3 (CME Globex MDP 3.0) coverage begins 2010-06-06 per
    // Databento's dataset listing (Stage 17A research); "to" is yesterday
    // (UTC) — Databento historical data lags live trading by roughly a day,
    // and Replay only ever needs fully-closed historical sessions anyway.
    return { from: Date.UTC(2010, 5, 6), to: Math.floor(Date.now() / DAY_MS) * DAY_MS - 1 };
  }

  async fetchCandles(params: FetchCandlesParams): Promise<FetchCandlesResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "DATABENTO_API_KEY is not configured." } };
    }
    const resolution = this.resolveSymbol(params.canonicalSymbol);
    if (!resolution.supported) {
      return { ok: false, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown/unsupported futures symbol: ${params.canonicalSymbol}` } };
    }
    if (params.from > params.to) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "from must be <= to." } };
    }
    const range = this.getSupportedRange(params.canonicalSymbol);
    if (range && (params.to < range.from || params.from > range.to)) {
      return { ok: false, error: { code: "OUT_OF_COVERAGE", message: "Requested range is outside Databento's known coverage." } };
    }

    let segments: ResolvedSegment[];
    try {
      segments = await resolveContract(params.canonicalSymbol, params.from, params.to, apiKey);
    } catch (error) {
      return { ok: false, error: mapError(error) };
    }
    if (segments.length === 0) {
      return { ok: false, error: { code: "OUT_OF_COVERAGE", message: "No contract resolves for the requested range." } };
    }

    const allCandles: Candle[] = [];
    const provenanceSegments: CandleProvenanceSegment[] = [];
    for (const seg of segments) {
      try {
        // Fetched and cached ONE UTC day at a time (§21) — a whole segment
        // can span many days, but every cache entry (and every request that
        // does hit Databento) stays at day granularity, matching
        // `market-data.service.ts`'s own L1 chunking.
        const dayStart = Math.floor(seg.from / DAY_MS) * DAY_MS;
        for (let day = dayStart; day <= seg.to; day += DAY_MS) {
          const dateKey = isoDate(day);
          const cacheable = isDayFullyClosed(day);
          let dayCandles: Candle[] | null = cacheable ? await readCachedDay(DATABENTO_DATASET, seg.contractSymbol, dateKey) : null;
          if (!dayCandles) {
            const text = await databentoGet(
              "/timeseries.get_range",
              {
                dataset: DATABENTO_DATASET,
                symbols: seg.contractSymbol,
                schema: "ohlcv-1m",
                stype_in: "raw_symbol",
                encoding: "json",
                pretty_px: "true",
                pretty_ts: "true",
                start: new Date(day).toISOString(),
                end: new Date(day + DAY_MS).toISOString(), // end exclusive — the whole UTC day
              },
              apiKey,
            );
            dayCandles = recordsToCandles(parseOhlcvResponse(text));
            if (cacheable) await writeCachedDay(DATABENTO_DATASET, seg.contractSymbol, dateKey, dayCandles);
          }
          const from = Math.max(seg.from, day);
          const to = Math.min(seg.to, day + DAY_MS - 1);
          allCandles.push(...dayCandles.filter((c) => c.timestamp >= from && c.timestamp <= to));
        }
        provenanceSegments.push({ contractSymbol: seg.contractSymbol, from: seg.from, to: seg.to });
      } catch (error) {
        return { ok: false, error: mapError(error) };
      }
    }

    allCandles.sort(compareCandles);
    const provenance: CandleProvenance = {
      providerId: this.id,
      datasetId: DATABENTO_DATASET,
      priceBasis: "raw-unadjusted",
      retrievedAt: new Date().toISOString(),
      segments: provenanceSegments,
    };
    return { ok: true, candles: allCandles, provenance };
  }
}

function mapError(error: unknown): { code: "UNSUPPORTED_SYMBOL" | "OUT_OF_COVERAGE" | "PROVIDER_ERROR"; message: string } {
  if (error instanceof DatabentoHttpError) {
    if (error.status === 401 || error.status === 403) {
      return { code: "PROVIDER_ERROR", message: "Databento authentication failed — check DATABENTO_API_KEY." };
    }
    if (error.status === 404 || error.status === 422) {
      return { code: "UNSUPPORTED_SYMBOL", message: `Databento could not resolve the requested symbol: ${error.message}` };
    }
    return { code: "PROVIDER_ERROR", message: error.message };
  }
  return { code: "PROVIDER_ERROR", message: error instanceof Error ? error.message : "Unknown Databento error." };
}

/** Used only by this stage's dev-only smoke-test script (never CI) to
 *  confirm the instrument catalog actually knows about a canonical root
 *  before spending a real API call on it. */
export function supportedCanonicalFuturesSymbols(): string[] {
  return Object.keys(FUTURES_ROOT_BY_CANONICAL).filter((s) => lookupInstrument(s) != null);
}
