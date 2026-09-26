# Native Replay V2 — historical data & candle engine

**Status: Prompts 1–2 complete** — MT5 M1 import (direct-to-R2), canonical
storage, the timeframe aggregation engine with progressively forming
candles, run↔dataset pinning and the authoritative replay clock. **Not built
yet:** the full-screen chart, drawings, position tools. Product direction: [BACKTESTING.md › Native Replay V2](./BACKTESTING.md#native-replay-v2-next-project).

```
MT5 M1 CSV
   ↓  domain/native-replay/mt5-m1-parser.ts     (format detection, columnar parse)
   ↓  domain/native-replay/m1-dataset.ts        (validation, normalisation, gaps, report)
HistoricalDataset + HistoricalBar               (server/services/native-replay/historical-dataset.service.ts)
   ↓  server/services/native-replay/historical-candles.service.ts   (ownership, cutoff, range fetch)
   ↓  domain/native-replay/candle-engine.ts     (pure aggregation, COMPLETED / FORMING)
BacktestRunDataset (run × asset → dataset, frozen once replay starts)
   ↓
BacktestReplayPosition (run × date × asset → latest revealed M1 bar)   (server/services/native-replay/backtest-replay.service.ts)
   ↓  getReplayCandles: cutoff = stored position, never the browser's
[next] full-screen replay chart
```

## Independence from Edge Review

Native Replay imports nothing from Edge Review: not `MarketDataImport`, the
`domain/market-data` candle/aggregation/`visibleCandles`/quality modules, the
providers, the replay clock or its pages — and Edge Review imports nothing
from Native Replay. Shared generic utilities only: the byte decoder
(`domain/prop-firms/import/source/decode-bytes.ts`) and the instrument
catalog (`domain/trade-plan/instrument-catalog.ts`) for symbol normalisation.

**Why not reuse the existing MT5 parser** (`domain/mt5-import`): it is
coupled to Edge Review's `Candle`/aggregation/quality modules and converts
timestamps to UTC under a trader-chosen convention, it silently deduplicates
(`mergeCandles`), and it does not scale — profiled at its own 4.2M-row
ceiling: detection splits the whole file just to read line 1 (1.5s, ~420MB),
and parsing materialises every cell as a string (10.8s, ~2GB heap); the
ceiling is applied *after* parsing everything, so it bounds nothing. That is
also the cause of the intermittent `mt5-parser.test.ts` row-ceiling timeout:
~12s isolated, >30s under full-suite GC/memory contention — a parser problem,
not only runner contention. Edge Review was left untouched (product decision);
the fix there would be to detect from the first lines only and enforce the
ceiling from a line count before parsing — exactly what Native Replay does.
The supported MT5 file shapes are the same.

## Import format

MetaTrader 5 "Export Bars" (View → Symbols → Bars → M1 → Export Bars):

```
<DATE>	<TIME>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
2024.05.14	09:00:00	1.07843	1.07850	1.07840	1.07848	35	0	3
```

- DATE `YYYY.MM.DD` (`-`/`/` tolerated), TIME `HH:MM[:SS]`, or one combined column.
- Tab (MT5 default) or comma (spreadsheet re-save).
- Header optional; with a header, columns are mapped **by name** (`<DATE>` or
  `DATE`, `TICKVOL`/`TICK_VOLUME`, `VOL`/`VOLUME`, `SPREAD`); unknown columns
  are refused. Without one, positional; TICKVOL/VOL/SPREAD optional.
- The symbol isn't in the file: read from MT5's default file name
  `SYMBOL_M1_<from>_<to>.csv`, or entered by the trader.
- Not supported: MT4 exports, semicolon/decimal-comma locales, other platforms.

Canonical fields per bar: `minute`, `open`, `high`, `low`, `close`,
`tickVolume?`, `realVolume?` (not stored when the VOL column is all zeros —
normal for FX/CFD), `spread?` (points).

## Symbol

`sourceSymbol` keeps the broker name verbatim (`EURUSD.a`, `XAUUSDm`, `GOLD`);
`symbol` is the instrument catalog's canonical symbol when it recognises the
name (suffixes/aliases), else the upper-cased source. No other mapping.

## Time semantics — no timezone guessing

MT5 exports carry the **broker server's wall-clock time** and no timezone.
Native Replay stores exactly that:

- `HistoricalBar.minute` = whole minutes since 1970-01-01 00:00 **on the
  dataset's clock** (`WallClockMinute`). It is not an instant; APIs format it
  as `YYYY-MM-DDTHH:mm` with no `Z`/offset.
- `HistoricalDataset.timeBasis = BROKER_SERVER`, `utcOffsetMinutes = null`
  (unknown). An offset is recorded only if the trader states it, and is never
  used for candle boundaries.
- Seconds must be `:00` (M1 bars open on the minute); anything else is a row error.
- All boundary math is integer arithmetic on wall-clock minutes (the `Date`
  object is used only as a UTC calendar calculator), so results never depend on
  the browser's, the server's or the trader's timezone.

## Validation

Everything below runs on every preview and again on import (a preview is never
trusted). **Blocking** (state `INVALID`, nothing stored):

| Check | Rule |
|---|---|
| File | non-empty, ≤ 150MB, decodable, tab/comma, recognised MT5 shape |
| Row ceiling | ≤ 2,000,000 lines, counted **before** parsing |
| Line | ≤ 512 chars; column count matches the header/first row |
| Timestamp | calendar-valid (leap years, month lengths; no roll-over), 1970–2100, minute-aligned |
| Price | strict decimal (no exponent/hex/NaN/Infinity/separators), > 0, ≤ 8 decimals, fits int32 at the dataset scale |
| OHLC | `high ≥ open, close, low` and `low ≤ open, close` |
| Volume / spread | non-negative; tick volume and spread whole numbers |
| Duplicates | same minute with **different** values → refused (no justified way to choose) |
| Timeframe | M1: if no two bars are one minute apart, refused ("looks like M5 data") |
| Symbol | known from the file name or entered |

Any invalid row blocks the import; up to 100 are listed with line numbers
and per-kind counts. **Non-blocking** (reported; `VALID_WITH_WARNINGS`):

- Out-of-order rows → sorted (order carries no information), counted.
- Exact duplicates (identical values, e.g. overlapping exports concatenated) → collapsed, counted.
- Sparse M1 (< 50% one-minute steps).
- Gaps (never filled — no synthetic bars): each missing interval is classified
  `WEEKEND` (spans a Saturday), `SHORT` (≤ 5 min, no-tick minutes),
  `RECURRING_DAILY` (same start/end time on ≥ 3 days — a session break),
  `INTRADAY`, `MULTI_DAY`. Only INTRADAY/MULTI_DAY (holidays, broker pauses,
  missing data — undecidable) set `reviewRecommended`. The 20 largest are listed.
- The same file (SHA-256) already imported.

## Storage

- `HistoricalDataset` (user-owned; not a Backtest Run's): source, sourceSymbol,
  symbol, baseTimeframe `M1` (CHECK), timeBasis, utcOffsetMinutes, priceScale
  (0–8, CHECK), first/last bar minute, barCount, volume flags, file name/size/
  SHA-256, source format, the full validation report, parserVersion, status,
  failureReason, readyAt. `seq` is a compact integer key for bar rows.
- `HistoricalBar` — one row per M1 bar: `(datasetSeq, minute)` primary key
  (DB-level uniqueness, and the only index a range read needs), OHLC as int4,
  tickVolume int4, realVolume float8, spread int4. ~91 bytes/bar including the
  index (500k bars ≈ 55MB).
- **Prices are exact integers** — price × 10^priceScale (MT5 points).
  priceScale = the most decimals the file uses; mantissas are parsed from the
  decimal string (never through a float), so "2357.4" and "2357.40" both become
  235740 at scale 2. EURUSD 1.07843 → 107843; GBPUSD 1.26381 → 126381; XAUUSD
  2357.42 → 235742. APIs return `int / 10^scale` plus `priceScale` for formatting.
- **No foreign key on bars, deliberately:** the row-level FK check made bulk
  import 14× slower (500k bars: 24.8s vs 1.8s). Statement-level triggers keep
  the guarantees: bars may be inserted only for an existing dataset that is
  `IMPORTING` (KEY SHARE-locked like an FK), bars are immutable, deleting a
  dataset (or its user) deletes its bars. CHECKs enforce valid OHLC, and that a
  READY dataset has bars and a range.

**Import lifecycle** — parse + validate fully in memory → create `IMPORTING` →
insert in 20k-row batches → verify the stored count → `READY` in one update.
Any failure deletes the bars and marks `FAILED` (with the reason). Only READY
datasets are ever served; an `IMPORTING` dataset older than 30 minutes (a
crashed import) is swept to FAILED. Deletion goes through
`deleteHistoricalDataset`, which refuses a dataset any Backtest Run has pinned (see Run pins).

## Timeframes and boundaries

Supported: **M1 M2 M3 M5 M10 M15 M30 H1 H2 H4 H6 H8 H12 D1 W1 MN1** (MT5's
standard set minus M4/M6/M12/M20/H3). All intraday lengths divide 24h, so one
generic rule covers them; W1 and MN1 are calendar rules. On the dataset clock:

| Timeframe | Bucket |
|---|---|
| M5 / M15 / M30 | `floor(minute / n) · n` — 09:00–09:04, 09:05–09:09 · 09:00–09:14 · 09:00–09:29 |
| H1 … H12 | anchored at server midnight — H4: 00:00, 04:00, 08:00 …; H6: 00:00, 06:00 …; H12: 00:00, 12:00 |
| D1 | server calendar day 00:00–23:59 |
| W1 | **Sunday 00:00** → Saturday 23:59 (MT5 stamps weekly bars on Sunday; a Sunday-evening open belongs to the week it starts) |
| MN1 | calendar month on the server clock (Jan→Feb, 29-day leap February, Dec→Jan tested) |

## Aggregation (pure, deterministic)

For the M1 bars of a bucket that are **at or before the cutoff**:

```
open       = first bar's open        high = max high      low = min low
close      = last bar's close
tickVolume = Σ tick volume           realVolume = Σ real volume (null if absent)
spread     = min spread              (MT5 bar spread is the bar's minimal spread; never summed)
barCount   = contributing M1 bars
```

## Progressive candles & lookahead

`cutoff` = the open time of the latest revealed M1 bar; it is **required** by
the engine, and it is the only "now": every timeframe requested at the same
cutoff sees exactly the same bars. The service fetches only `minute ≤ cutoff`
from the database (future bars never leave Postgres) and the engine re-applies
the cutoff. A bucket is `COMPLETED` once the cutoff reaches its last minute
(even if that minute had no bar), otherwise `FORMING` — only the final bucket
can be forming. The dataset's end counts as a cutoff, so a week/month the data
stops inside of is reported FORMING (its remaining minutes are unknown).

M30 at cutoff 09:17 = open of 09:00, max high / min low over 09:00–09:17,
close of 09:17 — never 09:18–09:29. **M1 is atomic:** the engine never
interpolates inside a minute or emits sub-minute points; a forming candle
changes only when a whole M1 bar is revealed.

## Candle API

`getHistoricalCandles(userId, { datasetId, timeframe, cutoff?, to?, from?, limit? })`
— **server-internal only** (no route: a caller-chosen cutoff would bypass the
replay clock; browsers use `getReplayCandles`): ownership + READY check → cutoff clamped to the dataset → bucket-aligned M1
range (limit mode widens the window across weekends/closures) → aggregation →
ascending candles `{ time, minute, open, high, low, close, tickVolume,
realVolume, spread, barCount, state }`, plus `priceScale`, `cutoff`,
`hasMoreBefore`. At most 5,000 candles / 800k M1 rows per request — the row budget is
enforced from the minute span BEFORE querying (a clamped window starts on a
bucket boundary, so no candle is truncated).
Consumers never query `HistoricalBar` directly.

## Limits (and why)

| Limit | Value | Rationale |
|---|---|---|
| File size | 150MB | ~2M M1 lines at ~60 bytes |
| Rows | 2,000,000 | ~5 years of one symbol; parse+validate 6s and ~210MB of typed arrays at the ceiling; checked before allocation |
| Line length | 512 | an MT5 bar line is ~60 chars |
| Price decimals | 8 | beyond MT5 bar data; keeps int32/exact math |
| Reported row issues / gaps | 100 / 20 | bounded report size under pathological files |
| Candles per request | 5,000 (800k M1 rows) | bounded server work per request |

Duplicate floods are bounded by the row ceiling and either collapse (identical)
or block (conflicting).

## Upload: browser → R2 → server import

Vercel caps function request bodies at 4.5MB, so MT5 files never travel
through an application request:

```
createImportUploadAction(fileName, size)      → HistoricalImportUpload PENDING
   server picks key native-replay-imports/<userId>/<uuid>.csv (DB CHECK: own prefix)
   and presigns ONE PUT: exact Content-Length + Content-Type signed, 15 min
browser PUT → R2 (private bucket)             — R2 rejects any other size (verified: 403)
previewImportUploadAction                     → HEAD (size must equal the announced size) + GET,
                                                validate, store the report (nothing imported);
                                                INVALID → FAILED, object deleted
completeImportUploadAction                    → claim PENDING→PROCESSING (runs once), re-validate,
                                                import → COMPLETED (datasetId) | FAILED; object deleted
sweep (on each new upload)                    → PENDING/PROCESSING past expiresAt (24h) → object deleted, EXPIRED
```

- The browser never gets credentials — only a URL valid for one key, one size,
  one content type, 15 minutes. It can't choose the key, so it can't overwrite
  another user's (or any media) object; `historical-import-storage.ts` refuses
  every key outside `native-replay-imports/`.
- **The source CSV is not kept.** The canonical bars are the durable copy; the
  report and file SHA-256 on the dataset are the audit trail, and re-importing
  the original file reproduces the same bars. Keeping it would double storage
  for no recovery benefit.
- Memory at the 2M-bar ceiling (118MB file): the full import (decode → parse →
  validate → write) takes ~29s and adds ~0.8GB peak RSS — within a 2GB Vercel
  function. A streaming parser isn't justified by these numbers; the data page
  declares `maxDuration = 300` for its import action.
- **One-time setup:** the bucket needs a CORS rule allowing browser PUTs from
  the app's origins, otherwise the browser's preflight fails (the UI says so).
  The app's R2 token is object-scoped and can't set it; add in Cloudflare
  (R2 → bucket → Settings → CORS policy):

  ```json
  [{ "AllowedOrigins": ["https://<production-domain>", "http://localhost:3000"],
     "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"],
     "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
  ```

## Run pins (BacktestRunDataset)

`run × asset → dataset`, one per asset of the run. Attaching checks: same
owner, dataset READY and M1, `normalizeSymbol(asset) === dataset.symbol`
(broker spellings like `EURUSD.a` compare equal; XAUUSD never attaches to
EURUSD), and bars inside the run period (the number of covered days is
reported). Before replay starts a pin can be replaced or detached. **The first
replay position freezes it** (DB trigger sets `frozenAt`); after that the
database refuses changing its dataset/asset, un-freezing, or deleting it —
only deleting the run removes it (the run's cascade). A pinned dataset can't
be deleted: the service names the runs using it, and the pin's foreign key
(NO ACTION) enforces it even if app code is bypassed. Deleting a run removes
its pins and positions, never datasets. DB triggers also enforce same owner,
READY-only attach, and that the asset is one of the run's.

## Replay clock (BacktestReplayPosition)

- **Key:** run × simulation date × asset. The simulation date is the
  Backtesting session date, read on the dataset's (broker server) clock.
- **Value:** `currentMinute` = the open time of the latest REVEALED M1 bar.
  The displayed timeframe is not stored — it is a view over the same moment,
  so switching M5↔H4 never moves time.
- **Initial position:** the first actual M1 bar of the date (never the whole
  day; not assumed to be 00:00). No session-open intelligence is assumed —
  the trader can jump forward (e.g. to London open).
- **Day boundary:** the date's last bar is the end. Play stops there; the
  next day is an explicit Session move with its own position.
- **+N bars** (`+1m` = N 1): the N-th next ACTUAL bar — gaps are crossed, never
  filled (09:14 → +1 → 09:17 when 09:15–16 are missing; 11:59 → 13:00 across a
  missing hour).
- **+1 displayed candle:** to the last bar of the candle the next bar belongs
  to — at 09:17 on M30 that finishes the current candle (→ 09:29); each further
  press reveals one whole candle (→ 09:59). Always resolves to a real bar.
- **Seek:** a wall-clock time later the same day → the last bar at or before
  it. Earlier than now → refused; another day → refused.
- **No rewind.** Trades and notes recorded at a replay time were decided with
  what was revealed; moving the clock back would let later knowledge leak into
  them. The chart may pan over revealed history freely; the clock can't move
  back (service rule AND DB trigger). A deliberate "restart day" (with
  consequences for that day's records) is future work.
- **Atomic moves:** each command locks the position row (`SELECT … FOR UPDATE`)
  for read-compute-write, so concurrent commands apply in sequence. Each
  carries a client command id; the last 32 are remembered on the position, so
  a network retry of an applied command returns the earlier result instead of
  moving again. Distinct commands all apply.
- **Candles:** `getReplayCandles(run, date, asset, timeframe, limit, to?)` loads
  the stored position and reads with cutoff = position. `to` only pans back
  (clamped to the position). No endpoint accepts a cutoff; the Prompt 1
  dataset candle route (arbitrary cutoff) was removed for that reason.
- **Assets:** each asset has its own clock (datasets have different bars and
  gaps). Caveat: two assets at different times can leak correlated information
  (EURUSD at 10:12 reveals the dollar move GBPUSD at 09:37 hasn't reached). V2
  shows one asset at a time; a run-wide lock-step mode is a candidate for the
  multi-asset chart stage.
- **Run status:** COMPLETED/ARCHIVED runs keep pins, positions and candles
  (readable); every move and attach is refused.
- **Playback** is browser-driven (no server timer): one command per tick,
  sequential, ≤ 5 requests/s. 1x = one M1 bar per second; ticks never faster
  than 200ms, so 10x/20x reveal 2/4 bars per tick. Every advance returns the
  revealed M1 bars for animation. Speed changes only delays: the revealed
  sequence and final state are identical at every speed (tested). Pause sends
  nothing further; the last applied command's position is the stored one.

## Performance (local Docker Postgres, M-series Mac)

| | 100,800 bars (5.9MB) | 501,120 bars (29.6MB) |
|---|---|---|
| parse + validate | 0.37s | 1.8s |
| full import (decode → verify) | 1.7s | 8.7s |
| storage | ~91 B/bar | ~91 B/bar (55MB) |
| 500 × M1 | 30ms | 17ms |
| 500 × M15 (7.5k M1) | 49ms | 45ms |
| 500 × H1 (30k M1) | 126ms | 141ms |
| 500 × H4 (120k M1) | 334ms (404 candles) | 489ms |
| 250 × D1 (359k M1) | — | 1.39s |
| 52 × W1 (368k M1) | — | 1.34s |

Aggregation itself is cheap (all 501k bars into any timeframe: 32–173ms);
cost is dominated by reading M1 rows from Postgres (~3.7µs/row; columnar
`array_agg`/`string_agg`/bytea transports were measured and gave ≤ 25%).
**Assessment:** on-demand aggregation is fast enough for M1–H1 replay and
acceptable for H4; long D1/W1/MN1 windows (> ~1s) will want a cache of
COMPLETED higher-timeframe candles per (dataset, timeframe) — safe because
datasets are immutable — with only the forming candle built from M1. Not
built until the chart's real access pattern confirms it.
Benchmark: `NATIVE_REPLAY_BENCH=1 npx vitest run src/server/services/native-replay/historical-performance.bench.test.ts --reporter=verbose`.

## Replay latency (in-process, local Postgres, 500k-bar dataset)

| Operation | Median | p90 |
|---|---|---|
| +1 bar | 24ms | 26ms |
| +5 bars | 25ms | 26ms |
| +30 bars | 26ms | 31ms |
| 500 × M1 candles | 21ms | 24ms |
| 500 × M30 | 68ms | 87ms |
| 500 × H1 | 116ms | 186ms |
| 500 × H4 | 447ms | 496ms |
| 6 × M30 (panel readout) | 20ms | 24ms |

Stepping cost is flat (one locked row + an indexed bar lookup), so request/
response is ample for M1 replay — no WebSockets. The chart should build the
forming candle client-side from the revealed M1 bars each step returns and
only refetch history on timeframe change / pan, keeping H4+ history reads
(~0.5s) off the hot path.

## Tests

- `domain/native-replay/timeframes.test.ts` — boundaries for every timeframe, W1 Sunday rule, MN1 Jan/Feb-leap/Dec transitions.
- `domain/native-replay/candle-engine.test.ts` — hand-calculated golden candles (M5/M15/M30/H1/H4/D1/W1/MN1), the progressive M30 (after 1/5/18/30 bars), no-lookahead spikes across all timeframes, one cutoff across M1…MN1.
- `domain/native-replay/import-analysis.test.ts` — formats, strict decimals, precision, malformed timestamps, invalid OHLC, duplicates, ordering, volume, non-M1, symbol, row ceiling, gap classification.
- `server/services/native-replay/historical-dataset.service.test.ts` — import lifecycle (preview, READY, INVALID, mid-write failure, crash sweep), DB backstops, ownership, service ≡ engine for every timeframe, cutoff enforcement, limits.
- `server/services/native-replay/historical-upload.service.test.ts` — direct-upload lifecycle (presign, preview, import once, concurrent completes, INVALID cleanup, size/type limits, ownership, owned-prefix CHECK, sweep never touching other objects).
- `server/services/native-replay/backtest-replay.service.test.ts` — pin compatibility/freeze/delete protection (service + DB), initial position, +1 over gaps, +N, +1 candle, seek rules, DB-refused rewind, M30 forming lifecycle, H4 at 09:37, M1…D1 synchronisation, lookahead attacks, date/asset independence, 10 concurrent steps, retried command ids, speed determinism, ownership, read-only runs.

## Next: the full-screen replay workspace

See the Prompt 2 stage report.
