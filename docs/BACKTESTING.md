# Backtesting Environment — V1

**Status: V1 complete** (external-chart backtesting). The next project is
**Traditorium Native Replay V2** — documented, not implemented (see
[Native Replay V2](#native-replay-v2-next-project)). It is independent of
Edge Review.

```
External historical chart (FX Replay, TradingView Replay, …)
        ↓  side by side
Backtesting Session  (the shared Today V2 workflow on a historical date)
        ↓
Backtesting Journal  (historical, review-only)
        ↓
Backtesting Analytics (canonical engine, R-first)
```

A trader creates a **Backtest Run** (one experiment: strategy + assets +
historical period), works through its trading days in the Session exactly as
in Today — Pre-Session, Today's Plan, Trade Idea, Execution, Review, Day
Summary, Refinement — then reviews the run in its Journal and Analytics.
Nothing a run records can reach live trading data, live accounting, or
another run.

---

## 1. Domain

### BacktestRun
`prisma/schema.prisma` → `BacktestRun`. Name, notes, assets, inclusive
`startDate`/`endDate` (date-only), `tradingWeekdays` (default Mon–Fri),
`status` (`ACTIVE` · `COMPLETED` · `ARCHIVED`), resume pointer
(`lastSessionDate`), optional simulation equity (`startingBalance`,
`riskPercentPerTrade`, `currency` — never a trading account).

### Environment ownership
Four tables carry `backtestRunId` (NULL = LIVE; a run id = owned by that run,
`ON DELETE CASCADE`): **TradingDay, Trade, TradeOpportunity, DailyNote** —
and, via those, every child (DailyAssetAnalysis, DirectionalEvidenceItem,
TradePlanScreenshot/Version, PlannedTarget, partial exits, behaviour labels,
psychology). `TradingEnvironment` is derived, never stored twice.

Uniqueness: the original live uniques are **partial** (`WHERE backtestRunId IS
NULL`, Prisma `partialIndexes`) and each run has its own
(`@@unique([backtestRunId, date])`, per-run trade numbers).

### Effective date
Services already take the date explicitly (`dateKey`). LIVE uses the real
trading day; BACKTEST uses the simulation date from the URL, validated inside
the run. `new Date()` inside services only records *when the trader acted*.
Wall-clock-derived defaults were replaced in a backtest (new-trade session
default, partial-exit time). Live auto-archive never runs for a run.

### Strategy snapshot
A run links its Strategy (SetNull) and freezes the full tree at creation
(`captureStrategySnapshot`, same shape as `StrategyVersion.snapshot`); every
trade still freezes its own snapshots. Drift from Strategy Lab is detected by
canonical-JSON comparison (ignoring `status`) and shown as a note — results
are never reinterpreted. A deleted strategy leaves the run fully usable.

### Lifecycle
`ACTIVE` → **Complete Backtest Run** (offered once the last trading day is
closed, or from the run menu; never automatic) → `COMPLETED` (reopenable) ·
`ARCHIVED` (restorable). Completed/archived: Session read-only; Journal and
Analytics fully available.

---

## 2. Isolation (defence in depth)

1. **Request scope** — `server/workspace/scope.ts`. `AsyncLocalStorage` holds
   `LIVE` · `BACKTEST(runId)` · `UNSCOPED(reason)`; outside any scope = LIVE.
   BACKTEST is only ever entered after ownership is verified
   (`runInBacktestRun`, `runInDayScope`, `runInRecordScope`).
2. **Singleton container, request-local value** — one store per process under
   `Symbol.for("traditorium.workspaceScope.store")` on `globalThis`, so every
   module copy (Next.js bundle layers, dev HMR) shares it, while each
   request's scope lives in its own async context: concurrent requests never
   share scope, and nothing request-specific is stored globally. Production
   processes each have their own store and Prisma client; a request stays in
   one process.
3. **Fail-closed verification** — the Prisma client exposes
   `$workspaceScope()` (the scope as its own query hooks see it); every entry
   point asserts it matches before running (`scope-tripwire.ts`). A mismatch
   refuses the work; users see "Something went wrong — nothing was saved";
   the detail is logged.
4. **Prisma filtering/stamping** — `prisma-scope.ts`: root models get
   `backtestRunId = scope` ANDed into every read/update/delete and stamped on
   create; child models get the relation filter. Creating a LIVE row inside a
   BACKTEST scope throws. An explicit `backtestRunId` in a query is a
   deliberate cross-run read (the run overview).
5. **Service guards** — no Performance Account allocation/settlement, no Prop
   Firm execution, no account allocation for simulated trades.
6. **Database triggers** (`BACKTEST_ISOLATION: …`) — environment immutable on
   all four tables; a simulated row's user must own its run; allocation /
   Performance snapshot / Prop Firm execution rows are rejected for simulated
   trades; trade ↔ opportunity links must share an environment.

**How actions choose the environment:** day-level actions (create, plan,
close, notes…) take `WorkspaceDayRef = { dateKey, runId: string | null }` —
required, nullable, no default. Record-tied actions derive it from the record
(raw SQL, user-scoped). Client components read `runId` from
`WorkspaceProvider`, which has no default and throws if missing.

**Not covered by the Prisma extension (audited):** raw SQL — every raw query
touching these tables scopes itself (trade numbering, record resolution,
run/live media collection); nested relation reads from non-root models — only
accounting and opportunity relations exist, all trigger-guarded.

**Concurrency:** trade numbering and default-routine seeding take
per-user `pg_advisory_xact_lock`s inside their transactions (both were
check-then-insert races, found by the concurrency tests). Pre-session
routine responses are merged atomically (`jsonb_set` on one item), and the
render-time structure sync compares sections canonically and only ever
rewrites `sections` — previously every page render rewrote the whole
snapshot from a stale read (jsonb key reordering made the comparison always
unequal), silently dropping ticks saved in between. This affected LIVE Today
too; found in V1 end-to-end QA and locked by `today-routine-race.test.ts`.

### Surface audit (V1 final)
| Surface | Behaviour |
|---|---|
| Today, Dashboard, Analytics, Accounts, Prop Firms, Edge Review, AI analyst, global search, Trades Album, trade gallery | LIVE only (unscoped = LIVE) |
| `/api/v1/*` (TradingView extension) | Explicit LIVE + tripwire; schema strips any `backtestRunId` |
| Auto-archive (the only background housekeeping) | LIVE loader only; never touches run days |
| Data Management | Live sections act on live rows and live media only; **Backtesting** is its own section; Reset deletes runs deliberately |
| Trade export | `/api/export/trades` LIVE only; `?runId=` exports one owned run |
| Media upload | Owner's environment resolved first (trade, analysis, note) |
| Journal routes | Run-scoped, read-only (review notes excepted) |

---

## 3. Workflow reuse

`/today` and `/backtesting/[runId]/session?date=` both call
`loadTradingWorkspace` and render `TodayWorkspace`. Environment differences
are minimal: live-only surfaces are hidden (Performance/Prop Firm allocation,
Edge Review commitments and reminders), Refinement shows the previous
simulated day's carry-forward (never a later day), the workspace remounts per
date, and a completed/archived run renders read-only. Opportunities can **Log
trade** through the same in-Session add-trade dialog (linked only within the
run; cross-run links are refused by the app and the database).

## 4. Results: settlement vs finalisation

`server/services/settlement-basis.ts`, chosen by scope:
- **LIVE** — final once the Performance Account settles (unchanged).
- **BACKTEST** — final once the trade's own recorded exits close the position;
  1R from the same stop hierarchy (actual → locked plan → planned stop);
  `settleBacktestTrade` mirrors the live one-way `Trade.actualRR` sync.

Applied to canonical analytics, Day Summary, Journal day summaries, Trade
Review and the run overview. R is primary; money only in the optional
fixed-risk simulation.

## 5. Journal

`/backtesting/[runId]/journal` (+ `/[date]`, `/[date]/trades/[tradeId]`):
the live Journal's calendar, day loader (`loadJournalDay`, read-only — viewing
creates nothing) and record components, scoped to the run. Days outside the
run/weekdays are muted; closed days, missed setups and notes are marked; no
money. Review-only: changes happen in the Session ("Open in Session" keeps the
date). **Review notes** (DailyNote per run + date, with images) stay editable
while the run is active. Totals come from `domain/journal/period-summary.ts`.

## 6. Analytics

`/backtesting/[runId]/analytics` → `getBacktestAnalytics`: the same canonical
loader (one trade query + one opportunities query) and pure functions
(`domain/backtesting/backtest-analytics.ts`): overview KPIs with sample sizes,
cumulative R + R drawdown (simulated-date order), breakdowns
(asset/direction/session/timeframe/weekday/month/entry model/setup type,
strategy version when >1), adherence (frozen snapshots), confluences and
execution confirmations (descriptive), missed trades (recorded outcomes
only), psychology/behaviour (descriptive), optional simulated balance. The
Overview cards use the same canonical rows (one batched query for all runs).

Live-vs-backtest comparison is ready at the data layer: both are the same
`CanonicalAnalyticsTradeRow[]`, differing only by scope.

## 7. Semantics decisions

- **Journal day W/L.** One rule everywhere: a trade is a win/loss/breakeven
  only once it has a **settled result**, classified by its sign
  (`settledWinLossClass` in `domain/analytics/canonical-dataset.ts`, shared by
  canonical Analytics and the Journal/Day Summary counts in
  `close-day.service.ts`). LIVE settles through the Performance Account,
  BACKTEST by price. The trader's Fully Closed confirmation no longer gates
  LIVE Journal counts (it used to — a leftover from before Analytics V2,
  commit `8e88cc7` — so a settled-but-unreviewed trade was a win in
  Analytics and uncounted in the Journal). A LIVE trade marked Fully Closed
  without a settled result is a Day Summary warning, not a result.
  Performance Account settlement rules are unchanged; Backtesting behaviour
  is unchanged. Test-locked (`backtest-v1-hardening.test.ts`).
- **Missed count.** "Valid" = scored valid (`setupValid === true`) — the
  Discrepancy Gap's own definition; unscored setups aren't counted (test-locked).
- **`fmtUsd`** now keeps the sign (`-$500`; `$0`).

## 8. Known V1 limitations

- The external chart can't be controlled: Traditorium keeps future run
  outcomes out of the Session, but can't stop the trader scrolling ahead in
  FX Replay.
- Completed/archived runs: trade sections render read-only; plan/pre-session
  inputs remain visible and saves are refused with a message.
- TradingView extension, global search and Trades Album are LIVE-only by
  design (backtest trades/screenshots are reached through the run's Journal).
- No Live-vs-Backtest comparison UI yet.

---

## Native Replay V2 (next project)

> **Progress:** the MT5 M1 historical-data foundation and candle engine are
> built — see [NATIVE_REPLAY.md](./NATIVE_REPLAY.md) (`HistoricalDataset` /
> `HistoricalBar`, validation, aggregation with progressively forming
> candles). Not yet built: run↔dataset pin, replay clock, chart, drawings,
> position tools.

Native Replay V2 replaces the external chart in the V1 flow with a
Traditorium-native, full-screen replay workspace. It feeds the Backtesting
Session, Journal and Analytics that already exist; those are not rebuilt.

### Independence from Edge Review

```
Edge Review
      X        no dependency in either direction
Native Replay
```

Native Replay is its **own subsystem**. It must not depend on Edge Review's
historical-data models, replay sessions, replay clock, provider abstraction
or page lifecycle. Edge Review stays untouched for now. Its future
relationship to Backtesting is undecided: it may remain, some concepts may
move into Backtesting, or it may be removed, once Native Replay and
Backtesting are mature.

Studying Edge Review's implementation for lessons is allowed (for example:
the no-lookahead `visibleCandles` idea, the server-authoritative atomic clock
advance, persisting position on pause instead of per tick, and the MT5
parser's row-ceiling handling). **Depending on it is not.** Native Replay
gets its own models, services and domain code, even where that means writing
something similar again.

Native Replay integrates directly with:

```
Backtest Run  ·  Backtesting Session  ·  Backtesting Journal  ·  Backtesting Analytics
```

### Canonical data source: exported MT5 M1 bars

For V2 the one historical market source is **MT5-exported M1 bar data**.
There are no multiple providers, external APIs, TradingView data or Edge
Review data.

```
MT5 M1 CSV
      ↓
Native MT5 Historical Dataset
      ↓
Validation / normalization
      ↓
Canonical M1 bars
      ↓
Timeframe Aggregation Engine
      ↓
Native Replay Clock
      ↓
Full-screen Replay Chart
      ↕
Backtesting Session
      ↓
Backtesting Journal
      ↓
Backtesting Analytics
```

Native Replay owns everything from the CSV down to the chart. At the chart ↔
Session boundary it hands context to the existing workflow.

### M1 is the source of truth; higher timeframes are derived

The trader normally uploads M1 once. Traditorium builds every supported
higher timeframe (M5, M15, M30, H1, H4, D1, …) from M1, with no separate
uploads. For a higher-timeframe candle:

| Field | Aggregation |
|---|---|
| Open | first included M1 open |
| High | max included M1 high |
| Low | min included M1 low |
| Close | last included M1 close |
| Volume | sum of included M1 volume (tick volume, and real volume when present, kept separately) |

**Boundaries follow the dataset's server/broker time convention**, recorded
at import (for example a broker on UTC+2/+3 with a 17:00 New York rollover).
They never follow the viewer's local timezone. H4 and D1 in particular
depend on it: D1 is the broker's trading day, not a UTC or local calendar
day.

### Progressive candle formation (no lookahead)

Replay advances through M1. A higher-timeframe candle is **built
progressively** from the M1 bars at or before the replay position:

```
09:00  first M1 opens the M30 candle
09:01  second M1 updates the same M30
 …
09:29  final M1 updates the M30
09:30  that M30 closes; a new M30 begins
```

At replay time 09:17, the active M30 candle is built **only from 09:00 →
09:17**. The completed historical 09:00–09:29 candle is never used, because
that would reveal the future. This applies to every higher timeframe.

**Multi-timeframe synchronization.** Every timeframe derives from the same
authoritative M1 replay position. At `14 May 2024 09:37`, switching between
M5, M15, M30, H1 and H4 must never reveal anything after 09:37. Each active
higher-timeframe candle represents only the M1 bars available up to the
position.

### M1 is the replay resolution

M1 is the smallest truthful unit in V2. Replay moves **one M1 bar at a
time**. Second-by-second ticks are **never fabricated** from M1 OHLC. The UI
may animate a transition later, but it must not imply knowledge of the
intra-minute path. True sub-minute replay would need MT5 tick data and is out
of scope.

### Dataset validation (at import)

Validate and report:

- symbol
- base timeframe (must be M1)
- date range and bar count
- chronological order and duplicate timestamps
- OHLC validity (`low ≤ open, close ≤ high`, positive prices)
- missing intervals
- the server/broker time convention
- which volume fields exist

**Missing minutes are not automatically corruption.** Weekends, holidays,
daily rollover breaks and illiquid minutes are legitimate gaps. Report gaps
(with market-closure gaps classified as expected) instead of rejecting the
import.

### Native subsystem concepts (proposed; names to finalise against the repo)

None of these touch Edge Review models.

| Concept | Purpose |
|---|---|
| `HistoricalDataset` | A user-owned MT5 M1 import: symbol, broker/server time convention, range, bar count, validation report, provenance. It belongs to the user, not to an environment, so one dataset can serve many runs. |
| `HistoricalBar` | Canonical, validated M1 bars (timestamp in dataset time, OHLC, volumes), stored or chunked for fast range reads. Higher timeframes are computed from these, never stored as a source. |
| `BacktestRunDataset` | Pins a run × asset to a dataset, frozen once replay starts so a run's results stay reproducible. |
| `BacktestReplayPosition` | Run × simulated date × asset → the authoritative M1 timestamp. Advanced only server-side, atomically, clamped to the simulated day. Play/pause/speed/timeframe stay ephemeral client state, saved on pause, asset switch or navigation, never per tick. |
| `ChartDrawing` | Drawings persisted in the run context (run × asset, optionally date), with tool type, anchor points in time/price, style and lock/hidden flags. |

Every chart data request resolves the replay position first and returns
server-side only bars at or before it. Client-side filtering is
defence-in-depth only. Indicators, prefetching and screenshots are all
bounded by the same position.

### Full-screen replay workspace

Replay takes essentially the whole viewport, like TradingView or FX Replay,
not a chart card inside the Session. The main Traditorium navigation may
collapse while Replay is active.

```
┌──────────────────────────────────────────────────────────────┐
│ Symbol │ Timeframe │ Date/Time │ Replay Controls │ Settings │
├──────┬───────────────────────────────────────────────────────┤
│ DRAW │                                                       │
│ TOOLS│                        CHART                          │
│      │                                                       │
├──────┴───────────────────────────────────────────────────────┤
│                       REPLAY TIMELINE                        │
└──────────────────────────────────────────────────────────────┘
```

**Controls:** play, pause, previous/next M1, advance N M1 bars, speed,
date/time jump (never past the simulated day's end), timeframe switch and
asset switch. Two distinct step units:

- **+1m** — one M1 bar; the active higher-timeframe candle updates.
- **+1 displayed candle** — advance to the next boundary of the viewed
  timeframe (for example the next M30 open), passing through every M1 bar in
  between.

### Drawing tools

A professional toolkit:

- trend line, horizontal line, horizontal ray, vertical line, ray, extended line
- parallel channel, rectangle, ellipse
- text, arrow, price marker
- Fibonacci retracement and extension
- measurement/ruler
- **Long Position** and **Short Position**

Interactions: select, move, resize, duplicate, lock, hide, delete, undo and
redo. Drawings persist per run (`ChartDrawing`).

**Long/Short Position tools** hold entry, stop loss and target(s), and show
price distance, pips/points, risk-to-reward and R. **Convert to Trade Idea**
hands these to the **existing** Backtesting Trade Idea workflow (the same
actions and `WorkspaceDayRef` scope). There is no second trade-planning
domain.

### Chart ↔ Session boundary

The replay workspace feeds context **into** the unchanged Backtesting
Session:

- asset
- timeframe
- replay timestamp
- position-tool prices → Trade Idea / execution fields
- chart screenshots as normal media attachments

It goes through the existing environment-scoped actions, so the V1 isolation
layers (ALS scope, Prisma extension, DB triggers) apply unchanged. Replay
never creates trades by itself. A trade exists only when the trader confirms
it through the workflow. Journal and Analytics consume the resulting trades
exactly as in V1.
