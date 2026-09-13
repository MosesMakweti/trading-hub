# Databento Futures Market Data (Stage 17B)

Real historical CME/CBOT/NYMEX/COMEX futures candles for Replay, plugged into
the Stage 13 `HistoricalMarketDataProvider` abstraction alongside
`FixtureMarketDataProvider`. Futures-only; forex/XAUUSD/indices stay on
Fixture until a Stage 17C provider is chosen.

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

## Supported symbols

Canonical `GC`, `ES`, `NQ` — plus their catalog aliases `MGC→GC`, `MES→ES`,
`MNQ→NQ`. The stage's requested list ("MGC, GC, MES, ES, MNQ, NQ") is six
strings but three canonical roots: Traditorium's instrument catalog already
canonicalizes the micro contracts onto their full-size counterpart (same
underlying price series, different contract size/tick value only) — this
stage added the missing `MGC→GC` alias to make that symmetric with the
pre-existing `MNQ→NQ`/`MES→ES` aliases.

## Contract resolution & rollover

`resolveContract(canonicalSymbol, from, to)` (in `databento-provider.ts`)
calls Databento's `symbology.resolve` against the **volume-based continuous
symbol** (`{root}.v.0`) rather than a handwritten rollover calendar. Volume
rollover reflects where real trading liquidity actually moved to — the most
faithful proxy for what a Replay trader would have been filling against —
versus calendar rollover (blind to liquidity) or open-interest rollover
(lags during rollover week). A request spanning a roll boundary comes back
as multiple `{contractSymbol, from, to}` segments; candles are always fetched
per LITERAL dated contract (e.g. `ESZ6`), never a back-adjusted continuous
series — real price gaps at a rollover boundary are preserved, never
smoothed.

## Timestamp & price semantics

- `ts_event` is the bar's **open/start** time — identical to Traditorium's
  own `Candle.timestamp` convention. No shift is applied.
- Prices are requested with `pretty_px=true`/`pretty_ts=true`; the adapter
  also defensively handles the raw fixed-point (×1e-9) / raw-nanosecond
  forms in case either isn't honored (see the adapter's own doc comment for
  exactly what's confirmed vs. assumed about Databento's API).
- Gaps (holidays, thin liquidity, a corrupt upstream line) are never
  filled — a missing minute simply isn't in the array.

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
recorded," never guessed.

## Licensing guard

`MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` (default off) gates whether
`resolveMarketDataProvider` will ever pick Databento, independent of whether
`DATABENTO_API_KEY` is configured. Real vendor data must not reach general
users until Databento's redistribution/display terms are explicitly
confirmed for this use case (see Stage 17A's research — licensing was the
recurring blocker across every vendor evaluated). A session that already
froze Databento provenance keeps using it even if this flag is later turned
off (freeze-once takes precedence over a later licensing-guard change).

## Cache (`DATABENTO_R2_CACHE_ENABLED`)

An opt-in, durable L2 cache in the existing Cloudflare R2 bucket, in front of
which the existing in-process L1 day-cache (`market-data.service.ts`) still
sits. Keyed `market-data/databento/{dataset}/{contractSymbol}/1m/{YYYY-MM-DD}.json`,
and ONLY for UTC days that are fully closed (today, and roughly the last 24h
of publication lag, are never cached — see `isDayFullyClosed`). Every read
is validated (schema version, contract/date match, strictly ascending
timestamps, no duplicates); anything that fails validation is treated as a
miss and re-fetched live, never trusted or hard-failed.

## Chunked/prefetch loading

Replay no longer fetches a whole review period in one server action call.
`domain/market-data/replay-prefetch-window.ts` computes small, day-aligned
chunks: a HIGH-priority rolling window around the Replay Clock's current
position (fast initial paint, bounded request size), then a LOW-priority
background sweep that fills in the rest of the period so whole-period
features (day navigation, jump-to-start) still work. Chart visibility is
still governed exclusively by the Clock (`visible-candles.ts`) — prefetched
data is never shown ahead of what the Clock allows.

## Dev-only real-data smoke test

`src/server/services/market-data/databento-live-smoke.test.ts` self-skips
unless `DATABENTO_API_KEY` is set (never blocks CI). Run it for real with:

```
DATABENTO_API_KEY=... npx vitest run databento-live-smoke
```

It logs the resolved contract(s), first/last timestamp, candle count, gap
count, and a sample candle for a known historical MES trading day.

## What's confirmed vs. assumed about Databento's API

See the top-of-file doc comment in
`src/server/services/market-data/databento-provider.ts` — Databento's own
docs site is heavily JS-rendered and could not be fetched as plain text
during this stage; the adapter's behavior is grounded in what could be
confirmed via `databento-python`'s plain-markdown README and targeted
searches, with every remaining assumption called out explicitly and handled
defensively (never silently guessed) in code.
