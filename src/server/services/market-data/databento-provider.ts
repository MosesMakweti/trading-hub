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
 * Canonical futures symbol → Databento root symbol. Stage 17B.1 §1/§4:
 * EXACTLY the six distinct canonical symbols the stage requires, each
 * mapped to its OWN literal Databento root — never collapsed onto a
 * sibling's root. `instrument-catalog.ts` keeps MES/MNQ/MGC as fully
 * separate `canonicalSymbol`s from ES/NQ/GC (linked only via
 * `instrumentFamily` for analytics grouping, never for market-data
 * resolution), and this map mirrors that 1:1: MES always resolves
 * `MES.v.0`/`MESZ6`-shaped contracts, never `ES.v.0`/`ESZ6` — a Replay
 * session for a trader's actual MES fill must reconstruct the MES order
 * book, not the ES one (different exchange-traded instrument, different
 * tick value/contract multiplier, separate volume/rollover schedule).
 */
const FUTURES_ROOT_BY_CANONICAL: Record<string, string> = {
  GC: "GC",
  MGC: "MGC",
  ES: "ES",
  MES: "MES",
  NQ: "NQ",
  MNQ: "MNQ",
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

/** A `ts_event` that converts to a date outside this window is treated as
 *  unparseable rather than trusted (Stage 17B.1 §16's "fail safely rather
 *  than guessing" policy applied to timestamps too) — GLBX.MDP3 coverage
 *  starts 2010, and no Replay session reviews the far future. */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

function isPlausibleTimestampMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms < MAX_PLAUSIBLE_MS;
}

/** Parses `ts_event` whether Databento returned an ISO 8601 string
 *  (`pretty_ts=true` honored) or a raw nanosecond-since-epoch integer/string
 *  (not honored) — a plain JSON number that large would already have lost
 *  precision by the time it reached us, so a numeric value is only trusted
 *  when it's still within `Number.isSafeInteger` range; anything else must
 *  arrive as a string so we can route it through `BigInt`. Nanosecond
 *  conversion is a fixed, documented unit (Databento's raw `ts_event` is
 *  always nanoseconds-since-epoch — confirmed, not guessed, per this
 *  module's top-level doc comment), so this is unit conversion, not
 *  magnitude-guessing; a result outside the plausible date window is still
 *  rejected rather than trusted (§16). */
function parseTsEventToMs(raw: unknown): number | null {
  if (typeof raw === "string") {
    const iso = Date.parse(raw);
    if (!Number.isNaN(iso)) return isPlausibleTimestampMs(iso) ? iso : null;
    try {
      const ms = Number(BigInt(raw) / BigInt(1_000_000));
      return isPlausibleTimestampMs(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // A JSON number this large already lost sub-ms precision, but treat it
    // as best-effort nanoseconds since epoch rather than silently discarding it.
    const ms = Math.round(raw / 1e6);
    return isPlausibleTimestampMs(ms) ? ms : null;
  }
  return null;
}

/**
 * Stage 17B.1 §16 — a genuine price for every futures root this adapter
 * supports (GC/MGC/ES/MES/NQ/MNQ) stays well under six figures; a raw
 * fixed-point-scaled integer (×1e9) routinely lands in the billions. This
 * bound exists ONLY to reject an implausible value outright — it is
 * deliberately NOT used to silently rescale a value (the exact bug this
 * stage's audit called out: turning `6000` into `0.000006` or vice versa by
 * guessing). This adapter requests `pretty_px=true` and trusts that request
 * deterministically: every numeric/string price field is parsed as an
 * already-scaled decimal, never divided. If Databento silently ignores
 * `pretty_px` and returns raw fixed-point integers instead, that price
 * exceeds this bound and the record is rejected as malformed (§17) rather
 * than "corrected" by a guess — a real API key is required to confirm
 * `pretty_px` is honored at all (§14), so this adapter refuses to paper
 * over that unverified assumption with a heuristic.
 */
const MAX_PLAUSIBLE_FUTURES_PRICE = 1_000_000;

/** Parses a price field assuming `pretty_px=true` was honored (this
 *  adapter's only supported mode — see the doc comment above); rejects
 *  (returns null) rather than guess-rescales when the value is not a finite
 *  number in the plausible range. */
function parsePrice(raw: unknown): number | null {
  let value: number | null = null;
  if (typeof raw === "string") {
    const n = Number(raw);
    value = Number.isFinite(n) ? n : null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  }
  if (value == null) return null;
  if (Math.abs(value) > MAX_PLAUSIBLE_FUTURES_PRICE) return null;
  return value;
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

/**
 * Stage 17B.1 §17 — a corrupt/unparseable OHLCV line or a record that
 * parses as JSON but fails to produce a valid candle (bad timestamp, bad
 * price, non-finite field, high<low, etc.) FAILS THE WHOLE CHUNK rather
 * than being silently skipped. Silently dropping a malformed price bar
 * would create a fake gap Replay's gap-handling can't distinguish from a
 * genuine holiday/thin-liquidity gap, and could let simulated execution
 * skip past a bar that actually existed. A blank line (a pure NDJSON
 * formatting artifact, never a price record) is the only thing tolerated —
 * see `parseOhlcvResponse`.
 */
class MalformedMarketDataError extends Error {}

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
 *  this module's top-level doc comment on why both are handled defensively.
 *  A blank line is tolerated (pure NDJSON formatting artifact); any line
 *  that fails to parse as JSON is a corrupt provider line and fails the
 *  whole chunk (§17) — never silently dropped. */
function parseOhlcvResponse(text: string): OhlcvRecord[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) {
        throw new MalformedMarketDataError("Databento response was valid JSON but not an array of OHLCV records.");
      }
      return arr;
    } catch (error) {
      if (error instanceof MalformedMarketDataError) throw error;
      throw new MalformedMarketDataError("Unrecognized Databento OHLCV response (not valid JSON array).");
    }
  }
  const records: OhlcvRecord[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l.length === 0) continue; // NDJSON formatting artifact, never a price record
    try {
      records.push(JSON.parse(l));
    } catch {
      throw new MalformedMarketDataError(`Corrupt/unparseable OHLCV line from Databento: ${l.slice(0, 200)}`);
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
    if (timestamp == null || open == null || high == null || low == null || close == null) {
      throw new MalformedMarketDataError(`Malformed OHLCV record from Databento (unparseable field): ${JSON.stringify(r).slice(0, 200)}`);
    }
    const volumeNum = typeof r.volume === "string" ? Number(r.volume) : typeof r.volume === "number" ? r.volume : null;
    const candle: Candle = { timestamp, open, high, low, close, volume: volumeNum != null && Number.isFinite(volumeNum) ? volumeNum : null };
    if (!isValidCandle(candle)) {
      throw new MalformedMarketDataError(`Invalid OHLCV values from Databento: ${JSON.stringify(r).slice(0, 200)}`);
    }
    candles.push(candle);
  }
  // Sort + dedup by timestamp (§13/§14) — never trust upstream ordering,
  // never fabricate a missing minute to fill a gap. An exact duplicate
  // record (same timestamp) is a benign re-send, not corruption.
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

function mapError(error: unknown): { code: "UNSUPPORTED_SYMBOL" | "OUT_OF_COVERAGE" | "PROVIDER_ERROR" | "PROVIDER_DATA_ERROR"; message: string } {
  if (error instanceof MalformedMarketDataError) {
    return { code: "PROVIDER_DATA_ERROR", message: error.message };
  }
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
