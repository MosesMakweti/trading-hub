# Databento Futures Market Data (Stage 17B, corrected Stage 17B.1)

Real historical CME/CBOT/NYMEX/COMEX futures candles for Replay, plugged into
the Stage 13 `HistoricalMarketDataProvider` abstraction alongside
`FixtureMarketDataProvider`. Futures-only; forex/XAUUSD/indices stay on
Fixture until a Stage 17C provider is chosen.

**Status: implemented but LIVE-UNVERIFIED.** No `DATABENTO_API_KEY` has been
available in any environment this adapter was built/reviewed in. Every test
in this repo's default suite mocks Databento's HTTP responses; nothing here
has exercised a real Databento connection. See **Live verification
checklist** below for exactly what to check the first time a real key is
available, and **What's confirmed vs. assumed** for which specific behaviors
are still open assumptions.

## Setup

1. Get a Databento account + API key: https://databento.com
2. Set `DATABENTO_API_KEY` in `.env` (server-side only — never
   `NEXT_PUBLIC_*`). Absent = Replay silently uses `FixtureMarketDataProvider`
   for futures too; nothing breaks without it.
3. To actually let Replay SHOW real Databento-backed candles to a user, you
   also need `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED=true` — see **Licensing
   guard** below. Both a key AND this flag are required.
4. Optional: `DATABENTO_R2_CACHE_ENABLED=true` (plus the existing `R2_*` vars)
   to enable the durable cache — see **Cache** below.
5. Dev-only: `MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE=true` (only takes
   effect when `NODE_ENV !== "production"`) lets a developer exercise the
   Databento path locally without flipping the production-facing licensing
   flag. Never usable in production, by construction.

## Supported symbols — Stage 17B.1 correction

**Six independent canonical symbols, six independent Databento roots. No
micro contract is aliased to its full-size sibling.**

| Canonical (`canonicalSymbol`) | Databento root | `instrumentFamily` (grouping only) |
| --- | --- | --- |
| `GC`  | `GC.v.0`  | `GC` |
| `MGC` | `MGC.v.0` | `GC` |
| `ES`  | `ES.v.0`  | `ES` |
| `MES` | `MES.v.0` | `ES` |
| `NQ`  | `NQ.v.0`  | `NQ` |
| `MNQ` | `MNQ.v.0` | `NQ` |

**Why this changed:** Stage 17B originally canonicalized `MES→ES` and
`MNQ→NQ` in `instrument-catalog.ts` (an alias, same convention as e.g.
`GOLD→XAUUSD`) and added a symmetric `MGC→GC` alias, reasoning that the
micro and full-size contracts "differ only in contract size/tick value."
That reasoning is correct for contract *economics* but wrong for
market-data *identity*: MES and ES (and MGC/GC, MNQ/NQ) are separately
exchange-listed instruments with their own order books, trade flow, exchange
volume, rollover schedule, and literal dated contract symbols
(e.g. `MESZ6` vs `ESZ6`). A Replay session for a trader's actual MES fill
must reconstruct the MES market, not a re-labeled ES market — fetching `ES`
candles for an `MES` trade would silently substitute a different
instrument's price/volume history.

**The fix:**
- `instrument-catalog.ts`: MGC/MES/MNQ are now full `CATALOG` entries with
  their own `canonicalSymbol` and their own real CME contract specs
  (`tickSize`/`tickValue`), not `ALIASES` entries. Only each micro's own
  TradingView continuous-contract suffix is aliased (`MES1!`/`MES1` → `MES`),
  exactly like every other root's `N1!` form.
- A new `instrumentFamily` field links siblings (`MES`/`ES` both →
  family `ES`) for **analytics/UI grouping only** — e.g. "show me all S&P
  e-mini trades regardless of contract size." It is never read by
  `databento-provider.ts`'s contract resolution or by
  `market-data.service.ts`'s provider selection; both key strictly off
  `canonicalSymbol`.
- `databento-provider.ts`'s `FUTURES_ROOT_BY_CANONICAL` and
  `market-data.service.ts`'s `DATABENTO_FUTURES_SYMBOLS` both now list all
  six symbols independently — `MES` resolves `MES.v.0`, never `ES.v.0`.
- Tick/spec audit (Stage 17B.1 §5/§9): MES tick value $1.25 (vs ES $12.5),
  MNQ tick value $0.50 (vs NQ $5), MGC tick value $1.00 (vs GC $10) — all
  publicly-documented CME contract specs, distinct per instrument, never
  inherited from the full-size sibling via alias collapsing.

**Migration impact:** no DB migration was needed or performed. Trade/plan
records store the trader's raw detected symbol text (`detectedSymbol`)
completely separately from the derived `canonicalInstrumentSymbol` — the raw
text was never rewritten by the old alias bug. A trade plan CONFIRMED before
this fix, whose `canonicalInstrumentSymbol` was derived through the old
MES→ES/MNQ→NQ/MGC→GC aliasing, may still show the full-size symbol in that
one denormalized column; its `detectedSymbol` (and any trade's own
`assetSymbol`, which was never passed through this alias table at all — see
next paragraph) are and always were correct. No bulk backfill was run
against that column, per this stage's explicit "avoid a migration if one
isn't required" instruction — flagged here as a known cosmetic gap in one
recognition-confirmation display field, not a market-data correctness bug.

**Note on Replay's own canonical symbol:** `ReplayReviewSession.assetSymbols`
(and the `canonicalSymbol` threaded through `getReplayCandles` →
`fetchReplayCandlesWithProvenance` → `resolveMarketDataProvider` →
`databento-provider.ts`) is the trader's raw, uppercased `Trade.assetSymbol`
— it was **never** routed through `instrument-catalog.ts`'s alias table in
the first place. This means the old MES→ES alias never actually caused a
live Replay session to silently fetch ES candles for an MES trade; instead,
because the old `FUTURES_ROOT_BY_CANONICAL`/`DATABENTO_FUTURES_SYMBOLS` only
listed `GC`/`ES`/`NQ` literally, an MES/MNQ/MGC trade's Replay session simply
never qualified for Databento at all and silently used Fixture. Stage 17B.1
fixes the actual root cause: MES/MNQ/MGC now qualify for Databento in their
own right, resolving their own literal contracts.

## Contract resolution & rollover

`resolveContract(canonicalSymbol, from, to)` (in `databento-provider.ts`)
calls Databento's `symbology.resolve` against the **volume-based continuous
symbol** (`{root}.v.0`) rather than a handwritten rollover calendar — and
`{root}` is always the canonical symbol's OWN root (`MES.v.0` for `MES`,
never `ES.v.0`). Volume rollover reflects where real trading liquidity
actually moved to — the most faithful proxy for what a Replay trader would
have been filling against — versus calendar rollover (blind to liquidity) or
open-interest rollover (lags during rollover week). A request spanning a
roll boundary comes back as multiple `{contractSymbol, from, to}` segments;
candles are always fetched per LITERAL dated contract (e.g. `MESZ6`), never
a back-adjusted continuous series — real price gaps at a rollover boundary
are preserved, never smoothed. Mocked-response tests cover all six roots
resolving independently (`databento-provider.test.ts`).

## Timestamp & price semantics

- `ts_event` is the bar's **open/start** time — identical to Traditorium's
  own `Candle.timestamp` convention. No shift is applied. A parsed timestamp
  outside a broad plausible date window (year 2000–2100) is rejected rather
  than trusted, on the same "fail safely, don't guess" principle as prices
  below.
- Prices are requested with `pretty_px=true`/`pretty_ts=true`.

### Price-parsing policy (Stage 17B.1 §16 correction)

Stage 17B's adapter defensively divided by `1e9` whenever a numeric price
exceeded a magnitude heuristic, to guess whether Databento had silently
ignored `pretty_px=true` and returned raw fixed-point integers instead. That
heuristic is exactly the failure mode this stage's audit called out: a
magnitude-based guess can silently turn a real price into nonsense (or vice
versa) with no way to tell it happened.

**The corrected policy:** this adapter now trusts its own request
deterministically. It asks for `pretty_px=true`; every price field
(string or number) is parsed as an already-scaled decimal, **never
divided**. If a parsed value falls outside a generous plausibility bound
(`MAX_PLAUSIBLE_FUTURES_PRICE = 1_000_000` — every one of GC/MGC/ES/MES/
NQ/MNQ's real prices stays far below six figures), the record is rejected as
malformed rather than "corrected" by rescaling — see **Malformed-data
policy** below. This means: if Databento does NOT honor `pretty_px` in
practice, every chunk for that request will fail loudly with
`PROVIDER_DATA_ERROR` instead of silently serving wrong-by-9-orders-of-
magnitude prices. That failure mode is intentional pending live
verification (§14) — it is the safe default until a real API key confirms
which mode Databento actually returns.

### Malformed-data policy (Stage 17B.1 §17 correction)

Stage 17B's adapter silently skipped any OHLCV line/record it couldn't
parse, reasoning that "a corrupt line is simply a missing candle" — treating
it the same as a genuine data gap (holiday, thin liquidity). This stage's
audit determined that's unsafe for Replay: a silently-dropped bad bar is
indistinguishable from a real gap, and Replay's execution engine or
gap-handling logic could treat a corrupted/missing fill as "no trading
happened here" when the truth is "the data was corrupt and we don't know
what happened here."

**The corrected policy:**
- A blank line (a pure NDJSON formatting artifact — never a genuine data
  record) is the ONLY thing tolerated/skipped.
- Any line that fails to parse as JSON, or any record that parses as JSON
  but yields an unparseable field (bad timestamp, bad price, non-finite
  value) or an invalid candle (e.g. high < low), **fails the entire chunk**
  with a new structured `PROVIDER_DATA_ERROR` code — never silently
  skipped, never partially served. The caller sees a clear error instead of
  a chart with an unexplained, unflagged gap.
- A day's candles are only cached (L1 or R2 L2) once the whole day has
  parsed cleanly — a partially-corrupt day is never cached in a
  partially-valid state.

## Provenance & freeze-once

Every `fetchCandles` call returns a `CandleProvenance` (provider id, dataset,
price basis, literal contract segments, retrieval time). Once a
`ReplayReviewSession` fetches an asset's candles for the first time, the
provider used is FROZEN on `ReplayReviewSession.marketDataProvenance`
(`replay-review.service.ts`'s `fetchReplayCandlesWithProvenance`) — later
fetches for that asset in that session keep using the same provider even if
global config changes, and error clearly (never silently fall back) if the
originally-recorded provider becomes unavailable. Sessions created before
this stage have no provenance recorded — rendered as "Legacy / source not
recorded," never guessed. An `MES` session's frozen provenance records
`canonical: MES`, `provider: databento`, `providerRoot: MES`, and a literal
segment like `MESZ6` — never `ES`/`ESZ6` (Stage 17B.1 §7).

## Licensing guard — historical provenance vs. current display permission (Stage 17B.1 §10/§11 correction)

Stage 17B treated "a session already froze Databento provenance" as
overriding a later change to `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` — once
frozen, that session kept showing Databento data even after the licensing
flag was turned back off. That conflates two genuinely separate concerns:

- **Historical provenance** (which provider/contract a session's candles
  actually came from) must remain immutable forever — this is a factual
  record of what happened, never rewritten.
- **Current permission to display/fetch licensed data** must obey current
  deployment policy — a real vendor's redistribution/display terms don't
  retroactively permit continued display just because a session once used
  that vendor.

**The corrected behavior:** `market-data.service.ts` exposes
`isProviderDisplayPermitted(providerId)`, checked independently of
`isAvailable()` (API key configured) on every fetch through a session's
pinned provider. Fixture is always permitted (no licensing concern —
synthetic data). Databento is permitted only when
`MARKET_DATA_EXTERNAL_DISPLAY_ENABLED=true`, or the explicit
non-production `MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE` — never merely
because a session's provenance already names it.

When a session frozen to Databento hits a display-disabled window:
- The frozen provenance record is left completely untouched — no write
  happens.
- Nothing is fetched from Databento, and nothing silently falls back to
  Fixture or any other provider substitution.
- `fetchReplayCandlesWithProvenance` returns a new structured error code,
  `PROVIDER_DISPLAY_DISABLED`, with a clear trader-facing message. The
  existing generic error-surfacing in `replay-market-panel.tsx` renders it
  like any other candle-fetch error — no bespoke UI was needed.
- If display is later re-enabled, the same frozen session resumes exactly
  where it left off — provenance was never lost or mutated in between.

A brand-new (never-fetched) asset in a session still resolves via
`resolveMarketDataProvider`, which itself checks `isProviderDisplayPermitted`
— so a first-time fetch with Databento disabled correctly falls back to
Fixture (no provenance exists yet to protect), while an *already-frozen*
Databento asset gets the explicit disabled-state error instead of a silent
substitution. See `replay-review.service.test.ts`'s
"licensing kill switch vs. frozen provenance" suite for both paths.

## Cache (`DATABENTO_R2_CACHE_ENABLED`)

An opt-in, durable L2 cache in the existing Cloudflare R2 bucket, in front of
which the existing in-process L1 day-cache (`market-data.service.ts`) still
sits. Keyed `market-data/databento/{dataset}/{contractSymbol}/1m/{YYYY-MM-DD}.json`,
and ONLY for UTC days that are fully closed (today, and roughly the last 24h
of publication lag, are never cached — see `isDayFullyClosed`). Every read
is validated (schema version, contract/date match, strictly ascending
timestamps, no duplicates); anything that fails validation is treated as a
miss and re-fetched live, never trusted or hard-failed.

Because the key includes the exact **literal dated contract symbol** (e.g.
`MESZ6`, never the root), a micro and its full-size sibling on the same date
always produce completely independent keys/entries — `.../MESZ6/...` can
never collide with `.../ESZ6/...`, and neither read nor write ever crosses
between them (Stage 17B.1 §18 — see `market-data-cache.test.ts`'s
"micro/full-size contract keys never collide" suite).

## Chunk/cache/prefetch invariants (Stage 17B.1 §12 clarification)

Stage 17B's own report used two different-sounding phrases ("every request
is bounded to at most one contract's UTC day" and "`MAX_CHUNK_DAYS` (7)") in
ways that could read as contradictory. They describe different layers; here
is the precise, current set of invariants:

| Layer | Unit | Where enforced |
| --- | --- | --- |
| Databento HTTP fetch (`timeseries.get_range`) | ≤ 1 literal contract × 1 UTC calendar day per call | `databento-provider.ts`'s per-day loop inside `fetchCandles` |
| R2 L2 cache entry | exactly 1 literal contract × 1 UTC calendar day | `market-data-cache.ts`'s `keyFor` |
| In-process L1 cache entry | exactly 1 provider × 1 canonical symbol × 1 UTC calendar day | `market-data.service.ts`'s `cacheKey`/`dayCache` |
| Browser → server action request (`getReplayCandles`) | day-aligned, ≤ `MAX_CHUNK_DAYS` (7) UTC days per call | `replay-prefetch-window.ts`'s `findNextUncoveredChunk`, called from `replay-market-panel.tsx` |
| HIGH-priority rolling window (chart's immediate viewport) | `PREFETCH_DAYS_BEHIND` (1) + `PREFETCH_DAYS_AHEAD` (3) days around the Clock, but still split into ≤ `MAX_CHUNK_DAYS`-bounded requests via the same primitive | `replay-prefetch-window.ts`'s `computeNextFetchWindow` |
| LOW-priority background sweep (rest of the review period) | ≤ `MAX_CHUNK_DAYS` (7) UTC days per request | `replay-prefetch-window.ts`'s `computeNextBackgroundChunk` |

In short: **the provider/cache layer is always 1-day granularity; the
browser-facing request layer batches up to 7 cached-or-fetched days per
call**, so a single `getReplayCandles` call can internally cause the server
to loop over up to 7 provider-level 1-day fetches (each independently
cacheable/cached). Neither layer ever fetches a "whole multi-week range" in
one Databento HTTP call — that bound is exactly what `MAX_CHUNK_DAYS`
governs at the browser-request layer, one level above the provider's own
strict 1-day-per-call discipline.

## Prefetch — no-hindsight is unaffected by prefetching ahead (Stage 17B.1 §13)

Replay no longer fetches a whole review period in one server action call.
`domain/market-data/replay-prefetch-window.ts` computes small, day-aligned
chunks: a HIGH-priority rolling window around the Replay Clock's current
position (fast initial paint, bounded request size), then a LOW-priority
background sweep that fills in the rest of the period so whole-period
features (day navigation, jump-to-start) still work. Downloading ahead of
the Clock is explicitly allowed and is the whole point of prefetching;
**revealing** ahead of the Clock is not, and is prevented at a single choke
point regardless of how much has been prefetched: both the chart
(`replay-market-panel.tsx`'s `visibleCandles` call) and the deterministic
execution processor (`advanceExecutionIfNeeded`'s own `visibleCandles` call,
further intersected with the trade's own watermark) read exclusively through
`domain/market-data/visible-candles.ts`, never the raw prefetched buffer
directly. `visible-candles.test.ts`'s "prefetch never leaks future data"
suite proves this explicitly: a full multi-day period already sitting in
memory (simulating prefetch having raced ahead) still yields only the
candles that have genuinely closed by the requested replay time, with zero
candles from a later day ever appearing — the same rule the execution feed's
watermark-intersected filter relies on.

## Dev-only real-data smoke test

`src/server/services/market-data/databento-live-smoke.test.ts` self-skips
unless `DATABENTO_API_KEY` is set (never blocks CI). Run it for real with:

```
DATABENTO_API_KEY=... npx vitest run databento-live-smoke
```

It fetches one known historical trading day for `MES` and logs the resolved
contract(s), first/last timestamp, candle count, gap count, and a sample
candle. This is a SMOKE TEST, not a substitute for the full checklist below
— it only exercises one symbol.

## Live verification checklist (Stage 17B.1 §15)

Nothing below has been checked against a real Databento connection yet. The
first time a real `DATABENTO_API_KEY` is available, verify EACH of the six
symbols independently — a pass on `ES` does not imply a pass on `MES`, since
they are different literal contracts/roots:

For each of `MGC`, `GC`, `MES`, `ES`, `MNQ`, `NQ`, on at least one known
historical trading day:

- [ ] `symbology.resolve` on `{root}.v.0` returns a literal contract (not
      empty, not an error) for that root specifically — confirm the
      response's key matches the requested root (e.g. `"MES.v.0"`), not a
      sibling's.
- [ ] The returned literal contract symbol has the expected shape for that
      root (e.g. `MESZ6`, not `ESZ6`).
- [ ] `timeseries.get_range` with `pretty_ts=true` returns `ts_event` as an
      ISO 8601 string (confirms the adapter's primary timestamp path is
      live, not just its defensive fallback).
- [ ] `pretty_px=true` returns already-scaled decimal prices, not raw
      fixed-point integers — if this FAILS, the adapter's price-parsing
      policy (see above) will surface `PROVIDER_DATA_ERROR` for every
      chunk; that must be resolved (likely: stop requesting `pretty_px` and
      implement confirmed raw-scale parsing instead of guessing) before
      this adapter is genuinely production-ready.
- [ ] 1-minute OHLCV candles are returned for a normal trading day (no
      schema/field-name surprises beyond `ts_event`/`open`/`high`/`low`/
      `close`/`volume`).
- [ ] No scale error: sample prices are visually sane for that instrument
      (e.g. ES/MES in the low thousands, GC/MGC in the low thousands,
      NQ/MNQ in the high thousands-to-tens-of-thousands, as of whatever
      historical date is tested).
- [ ] OHLC values are internally consistent (`low <= open,close <= high`)
      and believable against a known reference chart for that day.
- [ ] Volume values are believable (non-zero during active session hours,
      plausible relative magnitude between the micro and its full-size
      sibling).
- [ ] Genuine gaps (session close, thin overnight liquidity) are preserved
      as absent minutes, never fabricated/filled.
- [ ] One historical rollover window (a date range known to cross a
      contract roll) resolves to MULTIPLE segments with the expected two
      literal contracts and a correctly-placed boundary.

Only after every box above is checked for all six symbols should this
adapter's status change from "implemented but live-unverified" to
"production-verified" in this document.

## What's confirmed vs. assumed about Databento's API

See the top-of-file doc comment in
`src/server/services/market-data/databento-provider.ts` — Databento's own
docs site is heavily JS-rendered and could not be fetched as plain text
during Stage 17B; the adapter's behavior is grounded in what could be
confirmed via `databento-python`'s plain-markdown README and targeted
searches, with every remaining assumption called out explicitly and handled
defensively (never silently guessed, per the corrected price/malformed-data
policies above) in code. Nothing in Stage 17B.1 newly confirmed any of these
assumptions against a live connection — see the checklist immediately above.
