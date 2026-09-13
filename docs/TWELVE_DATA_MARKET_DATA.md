# Twelve Data Forex/Metals Market Data (Stage 17C.2, price-basis corrected Stage 17D)

Real historical Forex and spot-metals candles for Replay, plugged into the
Stage 13 `HistoricalMarketDataProvider` abstraction alongside
`FixtureMarketDataProvider` and `DatabentoHistoricalMarketDataProvider`.
Forex/metals only (EURUSD, GBPUSD, USDJPY, XAUUSD, XAGUSD); indices and
every other OTC/CFD instrument stay on Fixture until their own coverage and
symbol semantics are independently confirmed (§7 below).

**V1 is single-series ("AGGREGATED") 1-minute OHLC — an approximate
historical market reconstruction, NOT broker-exact execution simulation.**
No BID/ASK, no spread modeling. See **Price basis** and **Execution
semantics** below — and note the Stage 17D correction: this was originally
labeled `MID`, which asserted a fact Twelve Data's documentation doesn't
actually support for the specific endpoint this adapter calls. Corrected to
`AGGREGATED`, the accurate, provider-neutral term.

## Setup

1. Get a Twelve Data account + API key, on a **Business plan (Venture tier
   or above)** — see **Licensing** below for why a personal/individual plan
   is not sufficient.
2. Set `TWELVE_DATA_API_KEY` in `.env` (server-side only — never
   `NEXT_PUBLIC_*`). Absent = Replay silently uses `FixtureMarketDataProvider`
   for these assets too; nothing breaks without it.
3. To actually let Replay SHOW real Twelve Data-backed candles to a user,
   you also need `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED=true` — see
   **Licensing guard** below. Both a key AND this flag are required, and
   this flag is INDEPENDENT of Databento's
   `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` — they gate two separate vendor
   contracts and must never be conflated.
4. Optional: `TWELVE_DATA_R2_CACHE_ENABLED=true` (plus the existing `R2_*`
   vars) to enable the durable cache — see **Cache** below, and read
   **Subscription lifecycle** before ever letting a Twelve Data
   subscription lapse while this is on.

## Supported symbols (Stage 17C.2 §7)

Exactly five canonical symbols, each mapped to its own confirmed Twelve
Data ticker:

| Canonical | Twelve Data symbol |
| --- | --- |
| `EURUSD` | `EUR/USD` |
| `GBPUSD` | `GBP/USD` |
| `USDJPY` | `USD/JPY` |
| `XAUUSD` | `XAU/USD` |
| `XAGUSD` | `XAG/USD` |

**Deliberately excludes indices** (NAS100, US500, US30, etc.) — Stage
17C.1's research found Twelve Data offers an Indices product, but this
stage did not independently re-verify its exact symbol format/coverage,
and the spec is explicit: no speculative mappings. Adding indices is a
scoped follow-up, not a silent expansion of this adapter.

**Never bridges an INDEX/CFD canonical symbol onto FUTURES data or vice
versa** (Stage 17B.1's identity lesson) — NAS100 stays NAS100 and simply
isn't routed to any provider yet, never to NQ futures data just because the
two correlate.

## Symbol architecture (§8/§9/§34)

```
raw broker/display symbol (e.g. "XAUUSD.a", never rewritten anywhere)
        │
        ▼
canonical Traditorium instrument ("XAUUSD" — instrument-catalog.ts's
        parseSymbol, now including broker-suffix normalization, below)
        │
        ▼
market-data provider resolver (resolveMarketDataProvider — routes OTC
        canonical symbols to Twelve Data, futures to Databento, INDEX/CFD
        and everything else to Fixture)
        │
        ▼
Twelve Data provider symbol ("XAU/USD")
        │
        ▼
AGGREGATED 1-minute candles
        │
        ▼
frozen Replay provenance (providerId, priceBasis, segment)
```

**Broker suffix normalization** (`instrument-catalog.ts`'s
`BROKER_SUFFIX_PATTERNS`): many forex/CFD brokers append a cosmetic
account-type marker to the symbol they display — Alpari-style `"XAUUSD.a"`,
`"EURUSD.raw"`, or Exness-style `"XAUUSDm"`. These carry no
instrument-identity meaning (unlike a micro FUTURES contract, which IS a
genuinely different instrument — Stage 17B.1). Stripping is a FALLBACK
consulted only after a direct catalog/alias lookup fails, and only accepted
when the stripped form is an EXACT, already-known catalog key — it can
never invent a new mapping or override a successful direct match. The raw
text itself (`Trade.assetSymbol`, `TradePlanScreenshot.detectedSymbol`) is
never rewritten anywhere; this normalization only affects which provider
ticker the adapter resolves to.

## Contract resolution

Unlike Databento's futures (which need rollover/continuous-contract
resolution), Twelve Data OTC symbols have no such concept — `resolveSymbol`
is a direct, static map lookup (through the broker-suffix normalization
above). Each `fetchCandles` call therefore produces exactly ONE provenance
segment spanning the whole requested range, naming the Twelve Data provider
symbol (e.g. `"XAU/USD"`) — never a literal dated contract, since none
exists for an OTC instrument.

## Price basis: AGGREGATED (Stage 17C.2 §13, corrected Stage 17D §2)

`priceBasis: "AGGREGATED"` is the only value this adapter ever produces —
never MID/BID/ASK/TRADE. **What's actually confirmed vs. inferred**,
re-verified directly against Twelve Data's current documentation:

- CONFIRMED: Twelve Data computes forex/metals rates via a "weighted
  average method... prioritizing data from high-quality sources," and
  separately documents "mid-price updates every minute via WebSocket" for
  its real-time feed.
- **NOT independently confirmed**: that the literal "mid-price" label
  applies word-for-word to the REST `/time_series` HISTORICAL endpoint this
  adapter actually calls (the source page ties that exact wording to the
  WebSocket feed specifically).

**Stage 17C.2 originally labeled this `priceBasis: "MID"`** on the
reasoning that it's the closest and only documented term Twelve Data uses
for its overall forex rate product, and that a vendor running two
independently-computed pricing engines for the same instrument across its
real-time and historical APIs would be a surprising, undocumented design.
**Stage 17D's audit rejected that reasoning as insufficient**: "surprising
if untrue" is not the same as "confirmed," and Traditorium must not persist
or display a claim the evidence doesn't actually support — a session's
frozen provenance and the Replay source badge are both user-facing factual
assertions, not internal engineering shorthand. The value was corrected to
`"AGGREGATED"`, which asserts only what IS confirmed (a weighted-average
across multiple liquidity sources), stays provider-neutral, and required no
new field or enum — it was already anticipated as a legitimate value in
`docs/FOREX_XAUUSD_MARKET_DATA_DECISION.md` §13's original closed set
(`MID | BID | ASK | AGGREGATED | BROKER_QUOTED | INDICATIVE`).

**Before reverting to `MID`, confirm this in writing with Twelve Data**
(e.g. via their support channel) that `/time_series` specifically — not
just the WebSocket product — returns a true mid-price series. This remains
the single most important open item for this adapter, now correctly
reflected in what the code and UI actually claim rather than tracked only
in a doc while the code overclaims.

## Timestamp semantics (§14)

Twelve Data's `datetime` field is documented as "when the bar with the
specified interval was opened" — identical to Traditorium's own
`Candle.timestamp` convention, no shift applied. The adapter always
requests `timezone=UTC` (this parameter is honored for intraday intervals
like `1min`), but the RETURNED STRING still carries no explicit offset/`Z`
suffix (e.g. `"2026-08-03 09:00:00"`). Handing that directly to `new
Date(...)`/`Date.parse` risks the JS engine falling back to
LOCAL-timezone interpretation depending on the runtime — this adapter
instead parses the numeric components itself and builds the timestamp via
`Date.UTC(...)`, which is always deployment-locale-independent. A string
not matching the expected shape is rejected rather than guessed.

## Malformed-data & gap policy (§16/§17)

Same hardened policy Stage 17B.1 established for Databento: a corrupt/
unparseable record (bad timestamp, bad price, internally-inconsistent
OHLC) **fails the whole chunk** with `PROVIDER_DATA_ERROR` — never silently
dropped, since a dropped bad bar is indistinguishable from a genuine
missing-market-minute gap. No weekend/session-break/holiday candle is ever
synthesized — an empty `values` array is a real, empty result; Replay's
Clock and gap-handling logic handle the rest.

## Provider routing & freeze-once (§19/§20/§21)

`resolveMarketDataProvider` now routes: futures (GC/MGC/ES/MES/NQ/MNQ) to
Databento when licensed/configured; the five OTC symbols above to Twelve
Data when licensed/configured (independently); everything else to Fixture.
`replay-review.service.ts`'s freeze-once/licensing-kill-switch mechanism
(`fetchReplayCandlesWithProvenance`) is **fully provider-agnostic** —
adding Twelve Data required zero changes there, only a second entry in
`market-data.service.ts`'s `getProviderById`/`resolveMarketDataProvider`/
`isProviderDisplayPermitted`. A session that starts on Twelve Data for an
asset stays on Twelve Data for that asset's remaining life in that
session; if the key disappears mid-session, it errors clearly
(`PROVIDER_ERROR`) rather than silently falling back to Fixture.

## Licensing guard (Stage 17C.2 §6)

`TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED` (default off) gates whether
`resolveMarketDataProvider` will ever pick Twelve Data, independent of
whether `TWELVE_DATA_API_KEY` is configured — technical availability and
legal display permission are separate concepts. This is a **SEPARATE**
flag from Databento's `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED`: Databento and
Twelve Data are different vendors under different commercial agreements
(Stage 17C.1), and confirming one's redistribution terms must never
implicitly enable the other's. Per Stage 17C.1's research, a **Business
plan, Venture tier or above** ($414/mo self-serve as of this stage's
research) is the minimum tier documented to grant "external display" —
personal/individual tiers are explicitly internal-use-only by Twelve
Data's own terms. `MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE` (shared with
Databento, requires non-production `NODE_ENV`) lets a developer exercise
either provider locally without flipping a production-facing flag.

A session that already froze Twelve Data provenance does NOT keep
displaying it if this flag is later turned off — it returns
`PROVIDER_DISPLAY_DISABLED`, preserving the frozen provenance untouched,
same as Databento (Stage 17B.1 §10/§11).

## Cache (`TWELVE_DATA_R2_CACHE_ENABLED`)

A SEPARATE module from Databento's cache
(`src/server/services/market-data/twelve-data-cache.ts`, not a
generalization of `market-data-cache.ts`) — see **Retention & purge**
below for why. Keyed
`market-data/twelvedata/{priceBasis}/{providerSymbol}/1m/{YYYY-MM-DD}.json`,
with the provider symbol's `/` sanitized to `_` (e.g. `XAU_USD`) so it maps
to one flat, predictable key segment. Only for UTC days that are fully
closed (reuses Databento cache module's `isDayFullyClosed` — a pure,
provider-agnostic function). Every read is validated (schema version,
provider/basis/symbol/date match, strictly ascending timestamps, no
duplicates); anything that fails validation is a miss, re-fetched live,
never trusted or hard-failed.

## Retention & purge (Stage 17C.2 §24/§25/§26)

Stage 17C.1 found Twelve Data's commercial license ties caching rights to
the ACTIVE SUBSCRIPTION and requires deletion within 30 days of
termination — a materially stricter obligation than Databento's (which had
no such deadline documented). This is why the cache lives in its own
module under its own R2 key prefix (`market-data/twelvedata/`), completely
separate from Databento's (`market-data/databento/`) and from media
uploads.

**Purge mechanism**: `scripts/purge-twelvedata-market-data-cache.mjs`
deletes every object under `market-data/twelvedata/` and nothing else.
Deliberately hard to invoke by accident — requires an exact
`--confirm=PURGE-TWELVEDATA-CACHE` command-line flag. Never exposed as a
UI action or ordinary server action.

```
npm run purge:twelvedata-cache -- --confirm=PURGE-TWELVEDATA-CACHE
```

**Subscription lifecycle procedure** — if a Twelve Data commercial
subscription is ever terminated:

1. Set `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED=false` (disable display
   immediately).
2. Remove/rotate `TWELVE_DATA_API_KEY` (prevent any new fetches).
3. Run the purge script above within the contractual retention window
   (30 days of termination, per the confirmed license terms).
4. Do NOT touch `ReplayReviewSession.marketDataProvenance` — the
   provenance METADATA (which provider, which symbol, when) may and should
   remain even after the underlying candle data is purged; it is a
   historical record, not cached candle data.
5. Do NOT silently substitute another provider for historical sessions —
   a session that already used Twelve Data keeps reporting
   `PROVIDER_DISPLAY_DISABLED` for that asset going forward, exactly like
   the licensing-kill-switch behavior above (step 1 alone already causes
   this).

## Chunk/prefetch invariants

Unchanged from Stage 17B.1's architecture, fully provider-agnostic: R2
cache entry = 1 UTC day; provider fetch = ≤ 1 UTC day (this adapter
requests `outputsize=1500`, comfortably above a day's 1440 1-minute bars,
never a multi-day range in one Twelve Data call); browser-facing
`getReplayCandles` requests batch ≤ `MAX_CHUNK_DAYS` (7) cached-or-fetched
days per call via `replay-prefetch-window.ts`, which required NO
Twelve-Data-specific changes — provider selection is entirely server-side.
Prefetching ahead of the Clock is allowed; revealing ahead of it is not,
enforced at the same single `visibleCandles` chokepoint regardless of
provider.

## Rate limits & request budgeting (§30/§31)

Bounded retry/backoff (2 retries, exponential backoff) for 429/5xx/network
errors only — never for 4xx (bad request/auth/not-found), which retrying
can't fix. Twelve Data's Venture tier (610 req/min per Stage 17C.1's
research) comfortably covers a low-hundreds-of-users weekly/monthly Replay
workload at the existing 1-day-per-request granularity; the R2 day-cache
plus the in-process L1 day-cache (`market-data.service.ts`, provider-
agnostic, already deduplicates repeated requests for the same
provider+symbol+day) mean Replay never issues a live request per rendered
candle, and a day already served to one user is never re-fetched from
Twelve Data for another user reviewing the same historical day.

## Execution semantics (§18/§37)

**Chart and execution both use the same AGGREGATED OHLC series in V1 — no
spread simulation, no fixed-spread estimate, no BID/ASK.** This is a
deliberate separation of two independent concepts (Stage 17D §3): the
PROVIDER's price-basis label (`AGGREGATED` — a factual description of what
Twelve Data's `/time_series` endpoint is confirmed to return) and the
EXECUTION policy (single-series, no spread modeling — a product decision
about what Replay needs for behavioral review, unrelated to what the label
happens to be). The execution policy would be identical even if the
provider's basis were confirmed as a true mid-price tomorrow — V1 was never
"MID because execution uses one stream," it was "one stream because that's
sufficient for review," and the label change doesn't touch this reasoning
at all. Forex/OTC Replay V1 uses these aggregated historical candles and is
intended for strategy/behavioral review, not broker-exact fill
reconstruction. A future V2 (BID/ASK,
spread-aware fills: BUY at ASK, SELL at BID, stop/exit logic mirrored per
side) is a deliberately deferred upgrade — see
`docs/FOREX_XAUUSD_MARKET_DATA_DECISION.md` §14/§15/§24 for the full
reasoning and the bounded, additive engineering change it would require.
Nothing in this stage moves toward it; no BID/ASK candles, no dual
`CandleSeries`, no quote abstraction, no spread-aware order-fill engine
exist yet.

## Source badge & OTC disclosure (§32/§33)

The existing Replay source badge (`replay-market-panel.tsx`) now reads
`"Data: Twelve Data · XAU/USD · Aggregated"` for an OTC asset, alongside the
unchanged `"Data: Databento · MESZ6"` and `"Data: Synthetic Fixture"`
forms — never implying "broker-exact." Its tooltip is source-aware: for a
Twelve Data-sourced asset it reads *"Historical OTC market data may differ
slightly from your broker's chart. Replay uses this feed for market
reconstruction and review, not broker-exact execution."* — concise, shown
only on hover, never a standing banner.

## Internal development

Absent `TWELVE_DATA_API_KEY`, Replay silently uses Fixture for these five
symbols — nothing breaks. `MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE=true`
(requires `NODE_ENV !== "production"`) lets a developer exercise the real
Twelve Data path locally without flipping
`TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED`, which stays reserved for an actual
confirmed commercial license.

## Dev-only real-data smoke test

`src/server/services/market-data/twelve-data-live-smoke.test.ts` self-skips
unless `TWELVE_DATA_API_KEY` is set (never blocks CI) and prints "Live
Twelve Data verification pending API key" when it does. Run it for real
with:

```
TWELVE_DATA_API_KEY=... npx vitest run twelve-data-live-smoke
```

It fetches one known historical trading day for BOTH `EURUSD` and `XAUUSD`
and logs the resolved provider symbol, price basis, first/last timestamp,
candle count, gap count, and a sample candle for each. As of this stage,
this has NOT been run against a real key — status is **implemented but
live-unverified**, same discipline as Databento's own adapter carried
forward from Stage 17B.

## What's confirmed vs. assumed — summary

Re-verified directly against Twelve Data's current live documentation
during this stage (§2): base URL, `/time_series` parameters, response
shape (OHLC as decimal strings — no fixed-point scaling ambiguity the way
Databento's raw mode has), error shape, forex/metals symbol format
(slash-delimited), and the `datetime`-is-bar-open-time convention. NOT
independently reconfirmed: whether a true "MID" label (rather than the
current, accurate "AGGREGATED") would apply to the historical REST
endpoint specifically (see **Price basis** above — corrected Stage 17D
§2), and the
precise 1-minute historical depth per symbol (sources gave inconsistent
figures — this adapter does not hardcode an assumed start date as
confirmed; see `getSupportedRange`'s own doc comment in
`twelve-data-provider.ts`).
