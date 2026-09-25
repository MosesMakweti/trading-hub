# Edge Review — Market Data & Replay Foundation

How Edge Review's Replay workspace obtains historical market data, how a
trader can bring their own MT5-exported candles into it, and the
server-authoritative rule that guarantees Replay never leaks future price
action to the browser.

## Purpose

Edge Review's Replay tab reconstructs a historical review period
candle-by-candle so a trader can practice decisions "as if they were there
again." Two things must both hold at once:

1. The candles have to be **real** — either Traditorium's own vendor feeds,
   or a trader's own MT5 export.
2. The browser must **never** be able to see further ahead than the trader
   has actually stepped/played to, regardless of how the data was sourced.

This document covers the whole pipeline that makes both true.

## Providers

Every source implements the same `HistoricalMarketDataProvider` interface
(`src/domain/market-data/provider-types.ts`) — Replay's clock, execution
engine, and chart never know or care which one is behind it.

- **Automatic ("Traditorium Historical Data")** — `resolveMarketDataProvider`
  (`market-data.service.ts`) picks Databento for the six supported futures
  symbols, Twelve Data for the five supported OTC symbols, and Fixture
  (synthetic, always available) for everything else. This function **can
  never return the MT5 Imported provider** — there is no branch for it. See
  `docs/DATABENTO_MARKET_DATA.md` / `docs/TWELVE_DATA_MARKET_DATA.md` for
  those providers' own setup.
- **Explicit ("MT5 Imported Data")** — `Mt5ImportedHistoricalMarketDataProvider`
  (`market-data/mt5-imported-provider.ts`), reachable **only** via
  `getProviderById("mt5-imported", { userId, importId })` — never through
  automatic resolution. A trader must explicitly select it (or a session
  must already be frozen to it) for it to ever serve a single candle.

## MT5 Import

A trader's own MT5 "History Center → Export" bar-history file (CSV/TXT,
tab or comma delimited — see `domain/mt5-import/types.ts` for the exact
supported shape) goes through one pipeline, reused identically for both
preview and the real import:

```
file bytes
  → decodeMt5UploadBytes            (BOM/encoding-safe text)
  → detectMt5Format                 (delimiter, header, DATE/TIME shape)
  → parseMt5HistoricalData          (→ Mt5RawCandleRow[], still string dates)
  → resolveMt5Symbol                (broker-suffixed source symbol → canonical)
  → normalizeMt5Candles(convention) (→ canonical Candle[], UTC ms)
  → analyzeMarketDataQuality        (gaps, duplicates, coverage %)
  → buildMt5ImportPreview           (READY / READY_WITH_WARNINGS /
                                      NEEDS_USER_INPUT / INVALID)
```

`TimeConvention` is a closed union (`UTC` / `FIXED_OFFSET` / `IANA_ZONE`) —
never a bare string, never silently assumed; `NEEDS_USER_INPUT` is what the
UI shows when it's missing, rather than guessing.

Once confirmed (`mt5-import.service.ts`'s `confirmMt5Upload` →
`createMt5Import`):

- **PostgreSQL** gets ONE `MarketDataImport` row — metadata/index only
  (symbol, timeframe, time convention, date range, quality summary,
  candle count, `userId`).
- **R2** gets the actual candles, chunked one JSON object per calendar
  month (`lib/mt5-candle-storage.ts`), keyed by `(userId, importId, month)`.

## Dataset Selection

Selecting a Data Source in Replay (`components/replay/data-source/`) is a
two-part explicit choice, both required before a specific MT5 dataset can
ever serve candles:

1. **Provider**: `providerId = "mt5-imported"` (vs. leaving it on automatic).
2. **Exact dataset**: `datasetId = <the specific MarketDataImport.id>`.

`selectMt5DataSource` (`replay-review.service.ts`) writes both into the
session's provenance in one call, after checking the dataset covers the
**entire** review period (never a partial-coverage selection) and belongs
to the requesting user. It refuses once the asset's provenance is already
*consumed* (real candles served) — see **Replay Provenance** below for what
"consumed" means precisely.

## Replay Provenance

`ReplayReviewSession.marketDataProvenance` (`Json?`, no migration needed —
the shape already had room for this) is a map keyed by canonical asset
symbol:

```ts
{
  XAUUSD: {
    providerId: "mt5-imported",
    datasetId: "<MarketDataImport id>",   // only set for MT5; undefined for a vendor's own multi-contract merge
    priceBasis: "user-imported",
    retrievedAt: "2026-...",              // last time this entry was updated
    frozenAt: "2026-...",                 // when this asset's source FIRST froze
    segments: [{ contractSymbol, from, to }, ...], // what was ACTUALLY served, not just queried
  },
}
```

**Freeze-once**: the first `providerId`/`datasetId` a session ever records
for an asset is permanent — `fetchReplayCandlesWithProvenance` /
`advanceReplayClock` always re-resolve the provider via this SAME pinned
id/dataset, never re-running automatic resolution mid-session.

**Consumption**: `segments` (and therefore the freeze/lock) is only
recorded once a fetch actually reveals ≥1 visible candle — a fetch that
queries a provider but reveals nothing (e.g. it landed exactly on
`periodStart`, or a request during a gap) does **not** count. This is
deliberate: it's what lets `selectMt5DataSource` still be called freely
before the trader has genuinely seen anything, matching §16's "before
replay begins: Change; after: Locked."

## Authoritative Replay Clock

`ReplayReviewSession.replayCurrentTime` (+ `replayCurrentAsset`/
`replayCurrentTimeframe`) is the server-owned visibility boundary — not
just a UI resume-point. Exactly two functions may ever write it
(`replay-review.service.ts`; grep the repo for `replayCurrentTime` if this
ever needs re-verifying — nothing else touches it):

- **`advanceReplayClock`** — the only path that can move it **forward**.
  Takes a target, clamps it to `[currentBoundary, periodEnd]`, fetches the
  provider, and only writes the new boundary once the fetch has actually
  succeeded (a failed fetch leaves the boundary untouched — see
  **No-Future-Data Invariant**). The write is a single atomic SQL statement
  (`LEAST(GREATEST(...), COALESCE("replayCurrentTime", ...))`) computed
  against the row's own current value at write time, not a value read
  moments earlier in application code — this closes a real, proven race
  where a concurrent write could otherwise be lost.
- **`updateReplayProgress`** — a lightweight checkpoint for backward/no-op
  moves (pause, retreat, asset/timeframe bookkeeping). Same atomic-write
  technique; its own `LEAST(requested, current)` means it can **never**
  move the boundary forward, closing the mirror-image bypass (a direct call
  to this function can't be used to sneak the boundary ahead of a validated
  advance).

## No-Future-Data Invariant

> A replay client must never receive market candles whose open timestamp
> is later than the replay clock currently permits.

Enforced with ONE rule (`visible-candles.ts`'s `visibleCandles`): a
base-timeframe (1m) candle is visible iff `candle.timestamp + 60_000 <=
replayCurrentTime` — it must have **fully closed**, not just opened.

- **Server = the boundary.** `fetchReplayCandlesWithProvenance` (read-only —
  clips to `min(requestedTo, replayCurrentTime)` regardless of what's
  asked) and `advanceReplayClock` (the only path that can extend it) both
  call `visibleCandles` on the RAW provider/R2 result before it ever
  crosses the network. A provider or R2 may legitimately hold/cache data
  covering the whole period internally — that's fine, and even encouraged
  for efficiency — it just never leaves the server ahead of the boundary.
- **Client = defense-in-depth only.** The same `visibleCandles` /
  `buildHigherTimeframeView` calls still run client-side when building the
  chart view, but by the time candles arrive there the server has already
  guaranteed nothing future is among them. **Never remove the server-side
  call believing the client-side one is sufficient — it isn't, and was
  never meant to be alone.**
- **Aggregation never leaks.** The server never aggregates to a display
  timeframe itself — it only ever returns already-safe base (1m) candles.
  `aggregateCandles`/`buildHigherTimeframeView` run client-side on top of
  data that's already clipped, so an M15/H1/etc. bucket can never be
  constructed from M1 candles that don't exist client-side yet — there's
  nothing to leak from.

## Replay Flow

- **Step** — tries a local advance first (data already held, zero round
  trip); only when local data runs out does it call the server
  (`revealForward`, with a small-then-growing lookahead so a real gap —
  weekend/holiday — is crossed in a handful of requests, not hundreds).
- **Play** — a recursive `setTimeout` chain (not `setInterval`): a tick that
  needs a server round trip is fully awaited before the next tick is even
  scheduled, so playback can never race ahead of server-validated data.
  Speed governs the delay between ticks only.
- **Pause** — flips local `playback` state; an in-flight reveal from a tick
  started before Pause checks `playback !== "PLAYING"` after its await and
  discards its own result rather than applying it.
- **Reset** ("Jump to Start") — moves the clock back to the first available
  candle **and** discards client-held candles beyond that point
  (`discardFutureRelativeData`) — the browser doesn't just stop *showing*
  future-relative-to-reset data, it stops *holding* it. Ordinary
  single-step retreat does not discard (it's revisiting data the trader
  already legitimately saw, not new hindsight).
- **Reload** — resumes paused, at exactly `replayCurrentTime`, from a
  server-rendered fetch of the persisted resume point — never auto-starts
  playback. A concurrency guard (`advancingRef`, shared across Step/
  Play/day-nav) prevents overlapping reveals from racing each other.

A React `key={session.id}` on the Replay panel forces a full remount when
the trader switches to a **different** review period client-side (the
period-navigation arrows, or changing the WEEKLY/MONTHLY/asset-scope
controls) — without it, React reuses the component instance across the
prop change and every piece of local clock/candle state silently carries
over from the old session.

## Aggregation

M1 is the only base timeframe Replay ever stores/fetches. Every other
supported timeframe (5m/15m/30m/1h/4h/1D) is constructed client-side via
`aggregateCandles` (`domain/market-data/aggregation.ts`, untouched by this
foundation): Open = first constituent's open, High = max, Low = min, Close
= last constituent's close, Volume = sum only when every constituent
reports one (never a partial/misleading total). Bucket alignment is plain
UTC epoch math — normalized MT5 candles are already UTC by the time they
reach this layer, so no separate broker-time aggregation convention exists
or is needed.

## Ownership

Every MT5-path function is scoped by `userId` at the query itself
(`where: { id, userId }`), not a bolted-on check afterward — a foreign
import id simply doesn't exist from another user's perspective, the same
way every other per-user resource in this codebase is guarded. The
per-provider day-cache in `market-data.service.ts` is bypassed entirely for
`mt5-imported` (it's a per-user provider, never a shared vendor singleton;
routing it through a cache keyed only by `(providerId, symbol, day)` was a
real cross-user leak this foundation found and fixed early on).

## Known Intentional Limitations

- No tick-level replay, no bid/ask, no spread simulation — base timeframe
  is 1-minute OHLC only.
- No MT5 dataset deletion UI — sessions can reference a `datasetId`, and
  safe reference-handling for a deleted-but-still-pinned dataset hasn't
  been designed. The service layer already fails explicitly (never a
  silent fallback) if a pinned dataset somehow disappears; only the
  deletion UI itself is withheld.
- No other platform's market-data import (MT4, cTrader, NinjaTrader,
  Tradovate, XLSX/HTML) — only MT5 CSV/TXT bar-history exports.
- Strict per-candle "one legitimate step at a time" enforcement is not
  implemented at the API layer — `advanceReplayClock` validates a target
  against period bounds and dataset coverage, but a direct call can still
  request any in-period instant in one hop. This is a deliberate, scoped
  trade-off (avoiding a full step-history/event-sourcing system) — the
  core guarantee it does NOT weaken is that candle data crossing the
  network boundary always matches wherever the authoritative clock
  actually is.
