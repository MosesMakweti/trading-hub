# Native Replay V2 — historical data & candle engine

**Status: Prompts 1–3 complete** — MT5 M1 import (direct-to-R2), canonical
storage, the timeframe aggregation engine with progressively forming
candles, run↔dataset pinning, the run-wide authoritative replay clock, and
the full-screen replay chart workspace. **Not built yet:** drawing tools,
Long/Short Position, Convert to Trade Idea. Product direction: [BACKTESTING.md › Native Replay V2](./BACKTESTING.md#native-replay-v2-next-project).

```
MT5 M1 CSV
   ↓  domain/native-replay/mt5-m1-parser.ts     (format detection, columnar parse)
   ↓  domain/native-replay/m1-dataset.ts        (validation, normalisation, gaps, report)
HistoricalDataset + HistoricalBar               (server/services/native-replay/historical-dataset.service.ts)
   ↓  server/services/native-replay/historical-candles.service.ts   (ownership, cutoff, range fetch)
   ↓  domain/native-replay/candle-engine.ts     (pure aggregation, COMPLETED / FORMING)
BacktestRunDataset (run × asset → dataset, frozen once replay starts)
   ↓
BacktestReplayPosition (run × date → shared WORLD time)   (server/services/native-replay/backtest-replay.service.ts)
   ↓  getReplayCandles(asset, timeframe): cutoff = world time, never the browser's
/backtesting/[runId]/replay — full-screen chart workspace   (components/native-replay/replay-workspace.tsx)
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
reported). Before replay starts a pin can be replaced or detached. **The run's
first replay position freezes all its pins** (DB trigger sets `frozenAt`; a pin
attached later is frozen at once); after that the
database refuses changing its dataset/asset, un-freezing, or deleting it —
only deleting the run removes it (the run's cascade). A pinned dataset can't
be deleted: the service names the runs using it, and the pin's foreign key
(NO ACTION) enforces it even if app code is bypassed. Deleting a run removes
its pins and positions, never datasets. DB triggers also enforce same owner,
READY-only attach, and that the asset is one of the run's.

## Replay clock (BacktestReplayPosition) — one world time per run and day

- **Key:** run × simulation date. **Value:** `currentMinute` = the run's
  shared simulated WORLD time (wall-clock minute, dataset/server clock).
- **Why not per asset** (the Prompt 2 model): independent clocks let EURUSD at
  10:00 inform a GBPUSD decision at 09:20 — cross-asset lookahead. Every asset
  is now read as of the same world time: its latest real bar at or before it.
  If GBPUSD has no 09:37 bar, GBPUSD shows 09:35 — the world clock is never
  moved back to it.
- **The timeline** is the union of the real M1 bar minutes of the run's
  pinned datasets on that date. World time is always one of those minutes
  (DB trigger: a minute at which at least one pinned dataset has a bar).
- **Initial world time:** the earliest bar of the date across the datasets.
- **+N:** the N-th next timeline minute (any asset traded) — gaps crossed, never
  filled. **+1 displayed candle:** to the last timeline minute of the candle
  the next timeline minute belongs to. **Seek:** the last timeline minute at or
  before a later time today. **End of day:** the date's last timeline minute.
- **No rewind** (service + DB trigger), identity immutable, stays in its date
  (CHECK). Moves are locked transactions with retry-safe command ids (as
  before). Single-asset runs behave exactly as in Prompt 2.
- **Pins:** the run's first world position freezes every pin of the run; an
  asset attached after replay started joins the clock frozen at once.
- **Migration** (`20260927100000_native_replay_run_wide_clock`): per-asset rows
  were merged into one per run × date keeping the LATEST time (already revealed;
  an earlier one would move a clock backwards); columns pin/dataset/asset/day
  range dropped; new guard trigger.
- **Candles:** `getReplayCandles({run, date, asset}, {timeframe, limit, to?})` —
  asset and timeframe are the caller's view choice; the cutoff is the stored
  world time. `to` only pans back.
- **Run status:** COMPLETED/ARCHIVED runs are readable, never moved.

## Replay workspace (/backtesting/[runId]/replay?date=)

A `(replay)` route group with its own layout: authenticated like the app, but
without its sidebar/top bar/backdrop — the chart gets the viewport. Toolbar:
back to Session · asset · timeframes (M1 M5 M15 M30 H1 H4 D1 + More: the other
nine) · simulation date (prev/next trading day via the run calendar) · replay
time · +1m · +5m · +1 candle · Play/Pause · speed · Jump (server time) · volume
· Session. Left rail: crosshair / magnet (reserved for the drawing tools).
Status bar: world time, revealed minutes, the viewed asset's latest bar when a
gap puts it behind world time, shortcuts.

- **Chart library: lightweight-charts 5** (already a dependency — Apache-2.0,
  attribution logo kept). Chosen because it (1) renders time as UTC with no
  timezone support — exactly right for broker wall-clock time; (2) updates the
  last bar incrementally (`series.update`); (3) handles thousands of bars with
  pan/zoom/crosshair; (4) exposes coordinate conversion
  (`timeToCoordinate`/`coordinateToTime`, `priceToCoordinate`/
  `coordinateToPrice`) and series/pane primitives — the foundation for drawings
  and position tools; (5) supports panes (volume now, indicators later).
  Colours are hex/rgba (its parser rejects `oklch`/`var()`).
- **Broker time on the chart:** `chart-time.ts` is the only bridge — chart time
  = wall-clock minute × 60; every label (axis ticks, crosshair, legend) comes
  from our integer formatters. Tested with `TZ` set to Lusaka, London, New York,
  Tokyo, UTC; the browser QA rendered pixel-identical charts under three
  timezones.
- **Gaps:** bars are index-spaced — missing minutes, weekends and closures are
  compressed out (standard financial-chart behaviour, option B). No bar is ever
  created for a missing minute; the time axis labels the real times on either
  side of a gap.
- **Forming candle / printing:** each step returns the viewed asset's newly
  revealed M1 bars; `chart-model.ts` folds them into the displayed candles with
  the engine's own `openCandle` / `extendCandle` / `candleState` (no second copy
  of the candle math — equivalence tested against the server at every cutoff,
  all 16 timeframes), and only the changed candles are sent to the chart. No
  intra-minute path is invented; the candle changes once per revealed minute.
- **Reconciliation (server wins):** full server reads on open, asset/timeframe
  switch, older-history paging, pause, tab restore and after a failed/duplicate
  step; mismatches replace the client's candles. Nothing is optimistic: the
  clock and chart move only on server replies.
- **History:** opens with up to 500 revealed candles (prior days included);
  panning left prefetches older pages (≈1.5 screens ahead) — chart navigation
  only, it never touches the clock. The right edge is the world time: the chart
  holds no later candles (empty `rightOffset` space, `fixRightEdge`).
- **Follow:** the view follows new candles only while the latest candle is on
  screen; after panning back it stays put (even while playing) and shows
  "Return to replay" (R).
- **Zoom:** a fresh view (timeframe/asset switch) starts at the default bar
  spacing, fitting short histories to the width.
- **Keyboard:** Space play/pause · → +1m · Shift+→ +1 candle · R return to
  replay. Ignored while typing and inside the Session panel.
- **Session panel:** the existing Backtesting Session workflow (same loader and
  components as the Session page, in the run's BACKTEST scope), server-rendered
  into a collapsible right panel (~28% on desktop, overlay below 1024px). It
  stays mounted when hidden.
- **View state** (localStorage per run: asset, timeframe, panel, volume) is kept
  apart from replay state (server) — changing it never moves the clock.
- **Accessibility:** labelled controls, `aria-pressed` toggles, a live status
  region with the replay time, a textual OHLC legend; no motion beyond candle
  updates (panel transition honours reduced motion).

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

## Replay workspace performance (browser, dev build, 1920×1080)

| | |
|---|---|
| Open → 500 M1 candles rendered | 0.82s (one `setData`) |
| Timeframe switch (H1 / H4 / M30 / M1) | 59–98ms |
| Asset switch | 109–129ms |
| +1m chart update (series.update) | 0.2–0.4ms avg |
| 20x playback, 25s | 125 incremental updates, 5.0 req/s, update median 2.8ms / max 6.1ms, 0 `setData`, 0 chart re-renders; JS heap 49MB → 35MB after GC (no growth) |

## Tests

- `domain/native-replay/timeframes.test.ts` — boundaries for every timeframe, W1 Sunday rule, MN1 Jan/Feb-leap/Dec transitions.
- `domain/native-replay/candle-engine.test.ts` — hand-calculated golden candles (M5/M15/M30/H1/H4/D1/W1/MN1), the progressive M30 (after 1/5/18/30 bars), no-lookahead spikes across all timeframes, one cutoff across M1…MN1.
- `domain/native-replay/import-analysis.test.ts` — formats, strict decimals, precision, malformed timestamps, invalid OHLC, duplicates, ordering, volume, non-M1, symbol, row ceiling, gap classification.
- `server/services/native-replay/historical-dataset.service.test.ts` — import lifecycle (preview, READY, INVALID, mid-write failure, crash sweep), DB backstops, ownership, service ≡ engine for every timeframe, cutoff enforcement, limits.
- `server/services/native-replay/historical-upload.service.test.ts` — direct-upload lifecycle (presign, preview, import once, concurrent completes, INVALID cleanup, size/type limits, ownership, owned-prefix CHECK, sweep never touching other objects).
- `domain/native-replay/chart-model.test.ts` — client model ≡ server engine at every cutoff (random batches, world time past the asset's last bar, all timeframes), M30 printing 09:00→09:30, duplicate steps, wire precision, timezone-independent labels.
- `server/services/native-replay/backtest-replay.service.test.ts` — world clock across assets (latest bar ≤ world time, GBPUSD 09:38 spike invisible at 09:37 in every timeframe, union timeline, late pins), history paging, pin compatibility/freeze/delete protection (service + DB), initial position, +1 over gaps, +N, +1 candle, seek rules, DB-refused rewind, M30 forming lifecycle, H4 at 09:37, M1…D1 synchronisation, lookahead attacks, date/asset independence, 10 concurrent steps, retried command ids, speed determinism, ownership, read-only runs.

## Next: drawing and position tools (Prompt 4)

See the Prompt 3 stage report.
