# Replay performance — Next Candle

How a replay step works, what made it slow, what changed, and how to measure
it. Applies to the simulation terminal (Strategy Lab, Prop Firm Simulator) and
Native Replay (legacy Backtest Runs).

## 1. Trace of one Next Candle (before)

Simulation terminal, one M15 chart with 4 indicators:

| # | What happened | Cost |
|---|---|---|
| 1 | Server action `advanceSimClockAction`: transaction with 13 statements (account lock read twice, pinned feeds, 1–2 "find target minute" bar queries, a bar query for the step, positions, orders, balance, update) | 9 ms local · **157 ms** at 12 ms/statement |
| 2 | Same action, then a full `getSimAccountState`: 9 statements incl. a full ledger re-verification and the last 100 closed trades | 22 ms · **75 ms** |
| 3 | Client: bump `refreshKey` → every chart calls `getSimCandlesAction` (a 2nd server action, run after the 1st — Next.js runs actions one at a time) for 1,500 candles: 4 statements, re-aggregating ~22k (M15) to ~90k (H1) M1 bars, 272 KB of JSON | 40–62 ms · **81–99 ms** |
| 4 | Client: rebuild the chart model, recompute every study on 1,500 bars, `setData` on every series | 1–3 ms per chart, but **323 ms** with Ichimoku (an O(n²) bug) |
| 5 | Prop Firm accounts: the rules panel fetched its status after every step — another queued server action | +1 round trip |
| 6 | Scripts on the chart: each `ta.*` call recomputed its whole history on every bar (O(n²)) | up to **7.6 s** for 5,000 bars |

**The bottleneck was round trips and statements, not computation.** Every
database statement crosses a network boundary in production (Vercel `iad1` →
Neon `us-east-2`), so a step cost ~26 statements in 2 sequential actions,
plus the transfer and re-aggregation of the whole chart window.

## 2. What changed

### Server-side private bar buffer (`server/services/market-data/bar-cache.ts`)

Bars of a READY dataset are immutable (integrity triggers; a pinned dataset
can't be deleted), so the server keeps them in memory per dataset-day:

- LRU of day chunks with byte accounting, **40 MB cap** (measured per chunk;
  ~650 dataset-days). Empty days are cached too.
- One query per call for whatever is missing; concurrent loads of the same
  days share one promise; loads use the shared client (never a caller's
  transaction), and a failed shared load is retried by each waiter.
- Preload: after a step's response is sent (`after()`), the next two days
  are loaded in the background. Errors are swallowed — the next step loads
  what it needs itself.

**Physical availability ≠ logical visibility.** The buffer may hold bars
after an account's clock; it never decides visibility. Every read takes
bounds the caller derived from the account's clock under the account's row
lock, and only bars ≤ the clock leave the server. Future candles are never
sent to the browser — not even into a hidden buffer: a browser buffer would
let anyone read upcoming bars in DevTools, which would break the no-lookahead
guarantee for prop challenges. That is a deliberate limit on how fast a step
can be (see §5).

### One round trip per step

`advanceSimClockAction` now does, in one action:

1. The step transaction: **6 statements** (BEGIN, lock + balance in one
   statement, open positions, pending orders, clock update, COMMIT). Feeds are
   cached per account (pins are immutable); the target minute and the step's
   bars come from the buffer. Same results as before — tested on >200
   command/position combinations (`sim-market-buffered.test.ts`).
2. A **patch** instead of the full state when the step changed no trading
   state (no fill, close, expiry, ledger entry or rule verdict — the common
   case): clock, quotes, marked positions, balance/equity/floating. Ledger
   totals, orders and history are unchanged by definition. Any trading change
   returns the full state as before. Tested equal to the full state
   (`sim-step-fast-path.test.ts`).
3. The **M1 bars the step revealed** for the instruments on screen
   (fromMinute, toMinute] — never later. More than 3,000 bars (a long jump) →
   `null` and the chart reloads its window instead.

### Local candle folding

Each chart folds the revealed bars into its candles with the same pure
`applyRevealed` Native Replay uses (identical to the server's aggregation —
tested for M1…D1 after every step kind). A chart only folds if its candles
end exactly at the step's `fromMinute`; otherwise (still loading, switched
instrument) it reloads from the server — a stale response can never be
folded onto the wrong window. The window is trimmed back to 1,500 candles
once it grows past 2,000.

### Incremental chart updates (`components/charting/series-sync.ts`)

Each series remembers the points it holds; new data is compared and only the
changed points are sent with `update()` (or `update(…, historicalUpdate)` for
an older point, e.g. Ichimoku's lagging span). First loads, removed bars,
shifted times or large changes fall back to `setData`. Zoom, scroll,
drawings, panes and price scales are untouched.

### Indicators and scripts

- **Ichimoku** recomputed the whole `lowest` series for every bar
  (O(n²·p)): 323 ms → 0.86 ms on 1,500 bars, same values (tested).
- Built-in indicators recompute fully per step (1,500 bars × 12 studies ≈
  3.5 ms) — fast enough that incremental versions would add risk without a
  visible gain. Only the changed points reach the chart.
- **Script `ta.*`**: streaming implementations (`domain/indicators/ta-stream.ts`)
  that perform the same floating-point operations in the same order as the
  batch functions — **bit-identical**, verified by property tests on random
  series with gaps. Bars a call site skipped are fed as NaN (as before); a
  call site running twice in one bar (inside a loop) falls back to the batch
  computation, so every script's results are unchanged.

### Playback

Speeds are now **M1 bars per second** (1×–250×). The player asks for exactly
the bars that are due, never overlaps requests, and the server settles every
bar in order, so nothing is skipped regardless of speed. If the server can't
keep up, the backlog is capped and playback runs slower than requested.

### Native Replay

Its step reads the buffer too (target minute, day statistics, revealed bars):
15 → 10 statements, same results (its 126 tests pass).

### Fixes found while measuring

- The chart legend stayed on the last-hovered bar after the pointer left the
  chart (a leave event has no `sourceEvent` and was ignored as a "synced"
  move) — so the legend didn't show new candles until the next hover.
- The step buttons stayed disabled if a step threw (no `finally`).
- The Prop Firm rules panel refresh is debounced (600 ms) so it doesn't queue
  in front of the next step during playback; rules are still evaluated on the
  server at every minute.

## 3. Measurements

Production build (`next build && next start`) on the same container, one M15
chart + SMA, Bollinger, RSI, MACD, 60-day EURUSD dataset, 30 days in. "12 ms"
= a 12 ms delay added before every database statement to **simulate** a
remote database (`scripts/bench/pg-latency.cjs`); it is not a production
measurement. No internet round trip is included (browser and server on the
same machine) — real users add their own network latency **once** per step
now (twice before).

| Next Candle (click → chart shows the new candle) | Before | After |
|---|---:|---:|
| Local database | 153 ms (p90 179) | **32 ms** (p90 45) |
| 12 ms per statement (simulated) | 335 ms (p90 381) | **113 ms** (p90 116) |

Breakdown after (12 ms simulated), from the in-app instrumentation:

| Part | Median | p90 |
|---|---:|---:|
| click → response (network + server) | 98 ms | 102 ms |
| server time | 86 ms | 90 ms |
| response → charts painted (all client work) | 13.5 ms | 18.8 ms |
| fold revealed bars into candles | 0.1 ms | 0.2 ms |
| main series update | 0.9 ms | 1.7 ms |
| 4 studies update | 3.7 ms | 7.1 ms |

Server side (`scripts/bench/replay-step.bench.ts`):

| | Before | After |
|---|---:|---:|
| Statements per step (simulation terminal) | 13 + 9 + 4 per chart, 2 actions | **6**, 1 action |
| Step time, 12 ms/statement simulated | 157 + 75 + 81 ms | **82 ms** |
| Native Replay statements per step | 15 | **10** |
| Native Replay step, 12 ms/statement | 189 ms | **121 ms** |

Scripts (`scripts/bench/script-run.bench.ts`): "all rolling ta" 748 ms → 68 ms
(1,500 bars), 7,633 ms → 216 ms (5,000 bars).

Continuous play (`scripts/bench/replay-play-check.cjs`): two charts (M15, H1)
at 100× for 4 s: 164 non-overlapping steps, 410 bars revealed for 410 clock
minutes (nothing skipped); both charts identical to a fresh server load.

## 4. How to measure

- In the browser: `__replayPerf.summary()` in the console (last 200 steps).
- Server: `set -a; . ./.env.test; set +a; [BENCH_DB_LATENCY_MS=12] npx tsx scripts/bench/replay-step.bench.ts`
  (and `native-replay-step.bench.ts`, `chart-compute.bench.ts`, `script-run.bench.ts`).
- Browser: seed with `scripts/bench/seed-replay-account.ts`, start a
  production server (`BENCH_DB_LATENCY_MS=12 NODE_OPTIONS="--require ./scripts/bench/pg-latency.cjs" npx next start`),
  then `node scripts/bench/replay-browser.bench.cjs <url> <accountId>`.

## 5. Limits

- **A step is one network round trip.** The target "< 16 ms from click" can
  only be met by sending future candles to the browser ahead of time, which
  would expose them; it is not done. Client work after the response meets
  the target (13.5 ms median); the rest is network + 6 statements.
- The 6 statements are the floor with Prisma's interactive transactions
  (BEGIN/COMMIT are separate statements). Further gains would come from
  co-locating the functions with the database region (a deployment setting)
  or a server-side step procedure — not done.
- The buffer is per server instance: a cold instance pays one bar query per
  few days of data, as before. Memory is capped at 40 MB per instance.
- Built-in indicators are recomputed in full per step (fast; see above).
