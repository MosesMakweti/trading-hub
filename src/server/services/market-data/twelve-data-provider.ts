/**
 * Twelve Data Historical HTTP API adapter — Stage 17C.2, price-basis
 * corrected Stage 17D §2. The first REAL OTC `HistoricalMarketDataProvider`:
 * Forex + spot metals, single-series 1-minute OHLC (Stage 17C.1's decision
 * — see docs/FOREX_XAUUSD_MARKET_DATA_DECISION.md). This is an approximate
 * historical market reconstruction, NOT broker-exact execution simulation —
 * no BID/ASK, no spread modeling (Stage 17C.2 §18/§37). Every request is
 * server-side only (this module must never be imported from a "use client"
 * file) and gated on `TWELVE_DATA_API_KEY` — never `NEXT_PUBLIC_*` (§5).
 *
 * ## What's confirmed vs. assumed (Stage 17C.2 §2)
 *
 * Re-verified directly against Twelve Data's current live documentation
 * during Stage 17C.2 (not carried over unchecked from Stage 17C.1's notes).
 * CONFIRMED: base URL `https://api.twelvedata.com`, the `/time_series`
 * endpoint's parameters (`symbol`, `interval=1min`, `start_date`/`end_date`,
 * `timezone`, `order`, `outputsize` max 5000, `apikey`), the response shape
 * `{meta, values: [{datetime, open, high, low, close, volume}], status}`
 * with OHLC delivered as decimal STRINGS (no fixed-point/scaling ambiguity
 * the way Databento's raw mode has), the error shape
 * `{code, message, status: "error"}`, forex/metals symbol format as
 * slash-delimited (`"EUR/USD"`, `"XAU/USD"`), and — critically — that
 * `datetime` is documented as "when the bar with the specified interval was
 * opened" (matches `Candle.timestamp` exactly, no shift), with `timezone`
 * only affecting intraday intervals (1min qualifies) and forcing UTC when
 * explicitly requested.
 *
 * ## Price-basis correction (Stage 17D §2 — read before touching `PRICE_BASIS`)
 *
 * Stage 17C.2 labeled this adapter's output `priceBasis: "MID"`, reasoning
 * that Twelve Data's own docs describe forex/metals rates as computed by a
 * "weighted average method... prioritizing data from high-quality sources,"
 * and separately state "mid-price updates every minute via WebSocket." That
 * "mid-price" wording is tied to the WEBSOCKET real-time feed in the source
 * page, and was never independently confirmed to apply, word-for-word, to
 * the REST `/time_series` historical endpoint this adapter actually calls.
 * Stage 17D's audit determined that labeling it `MID` anyway asserted a
 * fact the evidence doesn't support — Traditorium must not persist or
 * display an unsupported claim, so this was corrected to
 * `priceBasis: "AGGREGATED"`: strictly accurate (a weighted-average across
 * multiple liquidity sources IS confirmed), provider-neutral, and already
 * anticipated as a legitimate value in `docs/FOREX_XAUUSD_MARKET_DATA_DECISION.md`
 * §13's original closed set (`MID | BID | ASK | AGGREGATED | BROKER_QUOTED
 * | INDICATIVE`) — no new field/enum was introduced, only a more honest
 * value of the existing free-form `priceBasis` string. If Twelve Data
 * confirms in writing (e.g. via their support channel) that `/time_series`
 * specifically returns a true mid-price series, this constant may be
 * changed back to `"MID"` — not before. See docs/TWELVE_DATA_MARKET_DATA.md
 * for the full history of this correction.
 *
 * Also still assumed: exact 1-minute historical depth per symbol (Twelve
 * Data's own support docs gave inconsistent figures across sources —
 * "~1 year" in one place, "typically multiple years" in another); this
 * adapter does not hardcode a specific start date as confirmed (see
 * `getSupportedRange`'s own doc comment) and instead relies on Twelve
 * Data's own response for the true boundary of what it can serve.
 */
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import type { Candle } from "@/domain/market-data/candle";
import { isValidCandle, compareCandles } from "@/domain/market-data/candle";
import { isDayFullyClosed, readCachedDay, writeCachedDay } from "@/server/services/market-data/twelve-data-cache";
import type {
  CandleProvenance,
  FetchCandlesParams,
  FetchCandlesResult,
  HistoricalMarketDataProvider,
  ProviderSymbolResolution,
} from "@/domain/market-data/provider-types";

const BASE_URL = "https://api.twelvedata.com";
const DAY_MS = 86_400_000;

/**
 * Stage 17C.2 §7/§11 — canonical Traditorium symbol → Twelve Data's own
 * `symbol` parameter format (slash-delimited, confirmed via current docs —
 * see this module's top-level doc comment). Deliberately ONLY the five
 * symbols this stage's research confirmed both coverage AND symbol
 * semantics for. Index/CFD instruments (NAS100, US500, etc.) are
 * DELIBERATELY EXCLUDED here — Stage 17C.1 found Twelve Data offers an
 * Indices product, but this stage did not independently re-verify its
 * exact symbol format/coverage, and §7 of this stage's spec is explicit:
 * "Do not add speculative mappings." Adding indices is a follow-up, not a
 * silent scope expansion. This map is also NEVER used to bridge an
 * INDEX/CFD canonical symbol onto a FUTURES canonical symbol or vice versa
 * (Stage 17B.1's identity lesson, restated in this stage's §20) — it only
 * ever maps a canonical symbol onto ITS OWN Twelve Data ticker.
 */
const CANONICAL_TO_TWELVE_DATA_SYMBOL: Record<string, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
};

/**
 * Stage 17C.2 §13, corrected Stage 17D §2 — the single price-basis label
 * this adapter ever produces. See this module's top-level doc comment
 * ("Price-basis correction") for exactly what is and isn't confirmed about
 * Twelve Data's `/time_series` price methodology. `"AGGREGATED"` asserts
 * only what's actually confirmed (a weighted-average across multiple
 * liquidity sources) — never `MID`/`BID`/`ASK`, which this adapter cannot
 * support as a factual claim for this specific endpoint.
 */
const PRICE_BASIS = "AGGREGATED";

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A parsed timestamp outside this window is treated as unparseable rather
 *  than trusted (same "fail safely rather than guessing" policy as the
 *  Databento adapter, Stage 17B.1 §16, applied here to timestamps). */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

function isPlausibleTimestampMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms < MAX_PLAUSIBLE_MS;
}

/**
 * Stage 17C.2 §14 — Twelve Data's `datetime` field (e.g.
 * `"2021-09-16 15:59:00"`) carries NO timezone offset/suffix in its own
 * string representation, even when `timezone=UTC` is requested (that
 * parameter changes which wall-clock time is reported, not the string
 * format). Handing a string like that to the generic `Date.parse`/`new
 * Date(...)` risks the JS engine falling back to LOCAL-timezone
 * interpretation for a non-ISO "date-time" string — exactly the
 * "must not silently depend on deployment locale" failure this stage's
 * spec calls out. This parser instead extracts the numeric components
 * itself and builds the timestamp via `Date.UTC`, which is always
 * timezone-independent regardless of the runtime's own TZ setting. Any
 * string not matching the expected shape is rejected (null) rather than
 * guessed.
 */
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

function parseUtcDatetime(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = DATETIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return isPlausibleTimestampMs(ms) ? ms : null;
}

/** Twelve Data delivers OHLC as decimal strings (confirmed — no fixed-point
 *  scaling ambiguity the way Databento's raw mode has, so no plausibility
 *  heuristic is needed here beyond "is this a finite number at all"). */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return null;
}

/** Volume "available not for all instrument types" per Twelve Data's own
 *  docs — absent/unparseable is `null` (never fabricated, never 0), same
 *  discipline as the Databento adapter's volume handling. Unlike a bad
 *  price/timestamp, a bad volume field does not fail the whole record —
 *  volume is informational, not part of a candle's OHLC identity. */
function parseVolume(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : null;
  return n != null && Number.isFinite(n) ? n : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

class TwelveDataHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Stage 17C.2 §16 — mirrors the Databento adapter's Stage 17B.1-hardened
 * policy exactly: a record that parses as JSON but yields an unparseable
 * timestamp/price, or an internally-inconsistent OHLC, FAILS THE WHOLE
 * CHUNK with `PROVIDER_DATA_ERROR` rather than being silently dropped — a
 * dropped bad bar is indistinguishable from a genuine missing-market-minute
 * gap, which Replay's gap-handling and execution engine must never confuse.
 */
class MalformedMarketDataError extends Error {}

/** Bounded retry/backoff for TRANSIENT failures only (429/5xx/network) —
 *  never for 4xx (bad request, auth, not-found), which retrying can't fix
 *  (Stage 17C.2 §30). */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 300): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const transient = error instanceof TwelveDataHttpError ? error.status === 429 || error.status >= 500 : true;
      if (!transient || attempt >= retries) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

interface TwelveDataValue {
  datetime: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}

interface TwelveDataSuccessResponse {
  status?: string;
  meta?: unknown;
  values?: TwelveDataValue[];
}

interface TwelveDataErrorResponse {
  status: "error";
  code?: number;
  message?: string;
}

/**
 * Stage 17D §21 — defense-in-depth secret redaction. This adapter's own
 * code never deliberately embeds the API key in a thrown error message
 * (only the endpoint path and response body are used), but since Twelve
 * Data authenticates via a QUERY PARAMETER (unlike Databento's HTTP Basic
 * Auth header), the key sits directly in the request URL — a network-layer
 * error message (from `fetch` itself) or, less likely, a vendor response
 * that happens to echo request parameters back could still surface it
 * verbatim. Every string that becomes part of a thrown error's `message`
 * is passed through this first, so even an unanticipated leak path (a new
 * error branch added later, a vendor quirk) can't put the live key in
 * front of a user or a log line.
 */
function redactApiKey(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join("[REDACTED]") : text;
}

/**
 * A single `/time_series` call. Auth is a query parameter (`apikey`) —
 * confirmed via current docs, unlike Databento's HTTP Basic Auth — and is
 * NEVER included in any thrown error message (only the endpoint path and
 * response body are, and even those are redacted defensively — see
 * `redactApiKey` above), so a log line can never leak the key. Twelve
 * Data's own error-response documentation shows a JSON `{code, message,
 * status:"error"}` body but doesn't explicitly confirm whether the
 * transport-level HTTP status always mirrors that `code` — this function
 * defensively checks BOTH: a non-2xx HTTP status, and a 200 response whose
 * JSON body says `status: "error"`.
 */
async function fetchTimeSeries(params: Record<string, string>, apiKey: string): Promise<TwelveDataSuccessResponse> {
  const url = new URL(`${BASE_URL}/time_series`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);

  return withRetry(async () => {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url.toString(), { method: "GET" });
      text = redactApiKey(await res.text(), apiKey);
    } catch (error) {
      throw new TwelveDataHttpError(0, `Network error contacting Twelve Data: ${redactApiKey((error as Error).message, apiKey)}`);
    }

    let parsed: TwelveDataSuccessResponse | TwelveDataErrorResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TwelveDataHttpError(res.status, `/time_series returned non-JSON response (status ${res.status}): ${text.slice(0, 300)}`);
    }

    if (!res.ok || (parsed as TwelveDataErrorResponse).status === "error") {
      const errBody = parsed as TwelveDataErrorResponse;
      const status = errBody.code ?? res.status;
      throw new TwelveDataHttpError(status, errBody.message ?? `/time_series responded ${res.status}: ${text.slice(0, 300)}`);
    }
    return parsed as TwelveDataSuccessResponse;
  });
}

function valuesToCandles(values: TwelveDataValue[]): Candle[] {
  const candles: Candle[] = [];
  for (const v of values) {
    const timestamp = parseUtcDatetime(v.datetime);
    const open = parsePrice(v.open);
    const high = parsePrice(v.high);
    const low = parsePrice(v.low);
    const close = parsePrice(v.close);
    if (timestamp == null || open == null || high == null || low == null || close == null) {
      throw new MalformedMarketDataError(`Malformed OHLC record from Twelve Data (unparseable field): ${JSON.stringify(v).slice(0, 200)}`);
    }
    const candle: Candle = { timestamp, open, high, low, close, volume: parseVolume(v.volume) };
    if (!isValidCandle(candle)) {
      throw new MalformedMarketDataError(`Invalid OHLC values from Twelve Data: ${JSON.stringify(v).slice(0, 200)}`);
    }
    candles.push(candle);
  }
  // Twelve Data defaults to DESCENDING order; this adapter requests
  // `order=asc` explicitly but never trusts that the param was honored —
  // always re-sorts + dedups deterministically (Stage 17C.2 §15), same
  // discipline as the Databento adapter never trusting upstream ordering.
  candles.sort(compareCandles);
  const deduped: Candle[] = [];
  for (const c of candles) {
    if (deduped.length > 0 && deduped[deduped.length - 1].timestamp === c.timestamp) continue;
    deduped.push(c);
  }
  return deduped;
}

export class TwelveDataHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly id = "twelvedata";
  readonly displayName = "Twelve Data (Forex/Metals — aggregated)";
  readonly baseTimeframe = "1m" as const;

  private apiKey(): string | null {
    return process.env.TWELVE_DATA_API_KEY || null;
  }

  isAvailable(): boolean {
    return this.apiKey() != null;
  }

  /**
   * Stage 17C.2 §8/§9/§34 — routes the incoming string through
   * `parseSymbol` first (uppercasing, stripping a broker's cosmetic
   * account-tier suffix like ".a"/".raw"/trailing "m") so a raw
   * broker-displayed symbol (e.g. "XAUUSD.a") resolves to the SAME
   * provider symbol as its already-canonical form ("XAUUSD") — the raw
   * text itself is never rewritten anywhere upstream (Trade.assetSymbol,
   * TradePlanScreenshot.detectedSymbol); this only affects which provider
   * ticker THIS adapter asks Twelve Data for. Exactly mirrors
   * `FixtureMarketDataProvider.resolveSymbol`'s existing pattern.
   */
  resolveSymbol(canonicalSymbol: string): ProviderSymbolResolution {
    const canonical = parseSymbol(canonicalSymbol).spec?.canonicalSymbol ?? canonicalSymbol.toUpperCase();
    const providerSymbol = CANONICAL_TO_TWELVE_DATA_SYMBOL[canonical];
    if (!providerSymbol) return { supported: false, providerSymbol: null };
    return { supported: true, providerSymbol, priceBasis: PRICE_BASIS };
  }

  getSupportedRange(canonicalSymbol: string): { from: number; to: number } | null {
    if (!this.resolveSymbol(canonicalSymbol).supported) return null;
    // Stage 17C.2 §2 — Twelve Data's own documentation gave inconsistent
    // 1-minute depth figures across sources ("~1 year" vs. "typically
    // multiple years") and this stage did not call the paid
    // `/earliest_timestamp` endpoint to pin an exact per-symbol answer.
    // Rather than hardcode a specific start date as if confirmed (the
    // exact mistake Stage 17B.1 corrected for Databento's price parsing),
    // this uses a generous, clearly-conservative floor and lets Twelve
    // Data's own response for a given day be the true source of truth —
    // an empty `values` array for a fully-in-range day is treated as a
    // real (if surprising) gap, never an error manufactured from a guess.
    return { from: Date.UTC(2015, 0, 1), to: Math.floor(Date.now() / DAY_MS) * DAY_MS - 1 };
  }

  async fetchCandles(params: FetchCandlesParams): Promise<FetchCandlesResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "TWELVE_DATA_API_KEY is not configured." } };
    }
    const resolution = this.resolveSymbol(params.canonicalSymbol);
    if (!resolution.supported || !resolution.providerSymbol) {
      return { ok: false, error: { code: "UNSUPPORTED_SYMBOL", message: `Unknown/unsupported OTC symbol: ${params.canonicalSymbol}` } };
    }
    if (params.from > params.to) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: "from must be <= to." } };
    }
    const range = this.getSupportedRange(params.canonicalSymbol);
    if (range && (params.to < range.from || params.from > range.to)) {
      return { ok: false, error: { code: "OUT_OF_COVERAGE", message: "Requested range is outside Twelve Data's known coverage." } };
    }

    const providerSymbol = resolution.providerSymbol;
    const allCandles: Candle[] = [];
    const dayStart = Math.floor(params.from / DAY_MS) * DAY_MS;

    try {
      // Stage 17C.2 §12/§28 — exactly one literal UTC day per provider
      // fetch/cache entry, matching Databento's and `market-data.service.ts`'s
      // existing day-chunked granularity. Twelve Data has no rollover/
      // continuous-contract concept (§11), so — unlike Databento — there is
      // only ever ONE implicit "segment" for the whole requested range.
      for (let day = dayStart; day <= params.to; day += DAY_MS) {
        const dateKey = isoDate(day);
        const cacheable = isDayFullyClosed(day);
        let dayCandles: Candle[] | null = cacheable ? await readCachedDay(PRICE_BASIS, providerSymbol, dateKey) : null;
        if (!dayCandles) {
          const response = await fetchTimeSeries(
            {
              symbol: providerSymbol,
              interval: "1min",
              timezone: "UTC", // forces UTC wall-clock datetime strings — never deployment-locale-dependent (§14)
              order: "asc",
              outputsize: "1500", // a full UTC day is at most 1440 1-minute bars; comfortably under Twelve Data's 5000 cap
              // Confirmed format is "2006-01-02T15:04:05" (docs' own example) — no "Z"/offset suffix.
              start_date: new Date(day).toISOString().slice(0, 19),
              end_date: new Date(day + DAY_MS).toISOString().slice(0, 19), // exact inclusivity unconfirmed — filtered again below regardless
            },
            apiKey,
          );
          dayCandles = valuesToCandles(response.values ?? []);
          if (cacheable) await writeCachedDay(PRICE_BASIS, providerSymbol, dateKey, dayCandles);
        }
        const from = Math.max(params.from, day);
        const to = Math.min(params.to, day + DAY_MS - 1);
        allCandles.push(...dayCandles.filter((c) => c.timestamp >= from && c.timestamp <= to));
      }
    } catch (error) {
      return { ok: false, error: mapError(error) };
    }

    allCandles.sort(compareCandles);
    const provenance: CandleProvenance = {
      providerId: this.id,
      priceBasis: PRICE_BASIS,
      retrievedAt: new Date().toISOString(),
      segments: [{ contractSymbol: providerSymbol, from: params.from, to: params.to }],
    };
    return { ok: true, candles: allCandles, provenance };
  }
}

function mapError(error: unknown): { code: "UNSUPPORTED_SYMBOL" | "OUT_OF_COVERAGE" | "PROVIDER_ERROR" | "PROVIDER_DATA_ERROR"; message: string } {
  if (error instanceof MalformedMarketDataError) {
    return { code: "PROVIDER_DATA_ERROR", message: error.message };
  }
  if (error instanceof TwelveDataHttpError) {
    if (error.status === 401 || error.status === 403) {
      return { code: "PROVIDER_ERROR", message: "Twelve Data authentication failed — check TWELVE_DATA_API_KEY." };
    }
    if (error.status === 404) {
      return { code: "UNSUPPORTED_SYMBOL", message: `Twelve Data could not resolve the requested symbol: ${error.message}` };
    }
    return { code: "PROVIDER_ERROR", message: error.message };
  }
  return { code: "PROVIDER_ERROR", message: error instanceof Error ? error.message : "Unknown Twelve Data error." };
}

/** Used only by this stage's dev-only smoke-test script (never CI) to
 *  confirm the adapter's own symbol map before spending a real API call. */
export function supportedCanonicalOtcSymbols(): string[] {
  return Object.keys(CANONICAL_TO_TWELVE_DATA_SYMBOL);
}
