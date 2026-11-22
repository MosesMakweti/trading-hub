# Charting Workspace & Scripting

Companion to [SIMULATION_PLATFORM.md](./SIMULATION_PLATFORM.md) (which covers the
simulation domain, Strategy Lab and the Prop Firm Simulator — already built and
live). This document covers the charting workspace and the scripting runtime.
§1–3 were written from the code at `75626c5` before the work began; §4 onwards describe what was built.

## 1. What exists (verified in code)

| Area | State |
|---|---|
| Chart library | `lightweight-charts` 5.2 (Apache-2.0). Series: candlestick, bar, line, area, baseline, histogram. Multiple **panes** (v5). Custom **series** and **primitives** (plugin API) for overlays. Time axis is a UTC timestamp; Traditorium maps broker wall-clock minutes onto it (`chart-time.ts`). |
| Chart wrapper | `components/native-replay/chart/replay-chart.tsx`: imperative handle, no candles past the replay position, history paging, follow mode. Candles only, one volume pane. |
| Data | MT5 M1 bars (OHLC + tick volume + spread), 16 derived timeframes (M1…MN1), progressive candles, server-side cutoff. **No tick data, no seconds, no volume-at-price.** |
| Drawings | 15 tools (trend, H-line, H-ray, V-line, ray, extended, rectangle, parallel channel, text, arrow, price label, measure, Fibonacci retracement, long, short), market-coordinate anchors, undo/redo, magnet, lock/hide, manager, persistence on legacy runs (`ReplayChartDrawing`). |
| Indicators | **None** anywhere in the codebase. |
| Workspace | Terminal with fixed-width side panel and fixed-height dock (`sim-terminal.tsx`). Single chart. View state partly in localStorage. |
| Editor / scripting | **None.** No editor dependency. |

## 2. Charting-library assessment

| Option | Capability | Licence / constraints | Verdict |
|---|---|---|---|
| **lightweight-charts 5** (current) | Fast canvas renderer, panes, custom series & primitives. No built-in indicators, drawing tools or chart types beyond the six series. | Apache-2.0 (attribution logo kept). | **Extend.** Everything missing is buildable on its plugin API: drawings are already primitives; indicators are series in panes; Heikin Ashi / Renko / etc. are data transforms rendered as candles. |
| TradingView **Advanced Charts** / Trading Platform library | Supercharts-like UI, 100+ indicators, 110+ drawing tools. **No Pine Script.** | Proprietary; free licence only for public web apps after an application/approval by TradingView; terms restrict use. | Not adopted — requires a licensing decision by the owner. It would replace the replay-aware chart and the drawing persistence already built. Recorded as an option, not a default. |
| ECharts / Highcharts Stock / others | General-purpose; financial features vary. | Various (Highcharts commercial). | No reason to switch; would duplicate working infrastructure. |

**Decision:** keep lightweight-charts and build the workspace on it. Limitations
accepted and documented: price/time-axis behaviour is the library's (no
inverted scale; logarithmic and percentage scales are supported); non-time
chart types (Renko, Kagi, Point & Figure, Line Break, Range) are rendered with
synthetic, monotonically increasing times — each brick/column carries the time
of the bar that completed it.

## 3. Scripting: Pine Script® v6 feasibility

Facts:
- Pine Script® is TradingView's proprietary language. Its compiler and runtime
  run on TradingView's servers; **no licensed third-party runtime or official
  compatibility route exists**, and TradingView's chart libraries do not
  include Pine.
- The language reference is public documentation. An independent interpreter
  written from a language's documented behaviour does not reuse TradingView
  code. "Pine Script" is a registered trademark, so it may only be used to
  *describe* compatibility, never as the name of Traditorium's feature.
- Full v6 parity (types, UDTs, methods, matrices, maps, `request.*` with
  every lookahead/gaps mode, the complete strategy engine semantics including
  `calc_on_every_tick`, ~1,000 built-ins) is a multi-month compiler project.

Options:
1. Full Pine v6 compatibility — not feasible now; not claimed.
2. **A documented Pine-v6-style subset, interpreted (chosen).** Same syntax and
   bar-by-bar series semantics for the supported features; anything outside
   the subset is a compile error that names the unsupported feature. The
   compatibility table (§5) is the contract and grows feature by feature.
3. A Traditorium-native language — rejected: traders already know Pine syntax.

Name in the product: **Traditorium Script** — "uses Pine Script®-style syntax
(a documented subset of v6)". The owner may want legal review of this wording.

Security: user code is never turned into JavaScript. It is parsed to an AST and
interpreted, so it can't reach `fetch`, the DOM, storage or the server. The
interpreter runs in a **Web Worker** in the trader's browser (isolated from the
page), with an instruction budget, a loop-iteration cap, output caps and a
wall-clock timeout; the server never executes scripts. Scripts only ever
receive the bars the chart already received — which the server already cut at
the replay clock — so a script cannot see the future.

Strategy scripts: run in the **Strategy Tester** against the revealed history
and produce a report (trades, equity, statistics). They do **not** place orders
on simulation accounts; doing so would need a server-side runtime so that
every order passes the account's execution and prop-firm rule services. That is
listed as future work rather than done unsafely in the browser.

## 4. What was built

Status key: ✅ done and tested · ⚠️ partial · ❌ not done.

### Charts (simulation terminal: Strategy Lab and Prop Firm Simulator)

| Feature | Status | Notes |
|---|---|---|
| Chart types: candles, hollow candles, OHLC bars, line, area, baseline | ✅ | Market prices. |
| Heikin Ashi, Renko, Line break, Kagi, Point & figure, Range bars | ✅ | Real transforms (`domain/indicators/chart-types.ts`, tested). Flagged on the chart as calculated values; brick types have a price-driven time axis. Indicators on them use the displayed values. Order entry always uses market prices. Range bars assume an open→low/high→close path inside each candle (stated in code). |
| Indicators (22): SMA, EMA, WMA, VWMA, Bollinger, Donchian, Keltner, VWAP (broker day), Supertrend, Ichimoku, Pivot points, RSI, MACD, Stochastic, ATR, ADX/DMI, CCI, Williams %R, Momentum, ROC, OBV, Volume | ✅ | Hand-checked tests and a no-lookahead property test. Volume-based ones use **tick volume** (MT5 has no traded volume) and say so. |
| Panes, legend with values under the cursor, hide / settings / remove per study | ✅ | Oscillator precision adapts to magnitude. |
| Chart settings: grid, crosshair (free / magnet / hidden), regular / log / percent / indexed scale, tick volume pane, last-price line, candle colours | ✅ | Persisted per user. |
| 1, 2 (side by side / stacked), 3 and 4-chart layouts | ✅ | Each chart: own instrument, interval, type, studies. Sync crosshair / time / instrument / interval. All bounded by the same account clock. |
| Timeframe favourites + all 16 intervals | ✅ | |
| Resizable right and bottom panels (mouse and keyboard), collapsible left / right / bottom, focus mode (Shift+F / Esc), built-in and saved presets | ✅ | Bottom panel capped so charts keep ≥ ~240 px. |
| Workspace persistence | ✅ | `ChartWorkspace` per user, validated server-side, restored field by field (a bad field never breaks the terminal). |
| Volume profile / volume-at-price | ❌ by design | Would need tick or traded volume per price; OHLC candles can't supply it honestly. |
| Compare symbols, alerts that notify, chart image export, undo for workspace edits | ❌ | Not built. |
| Native Replay (legacy runs) chart | unchanged | Still the single-chart Native Replay workspace; it gained the new drawing tools only. |

### Drawings

| Feature | Status | Notes |
|---|---|---|
| 23 tools: trend, horizontal line / ray, vertical line, cross line, ray, extended, parallel channel, regression channel (±2σ over revealed candles), pitchfork, rectangle, ellipse, triangle, Fibonacci retracement / extension, text, arrow, price label, measure, date range, price range, long / short position | ✅ | 8 tools new in this work; shared with Native Replay. Geometry is pure and tested. |
| Persistence on simulation accounts (`SimChartDrawing`), per instrument, shared by every chart of that instrument | ✅ | Ownership checked in the service and by a database trigger; ended accounts are read-only. |
| Undo / redo, lock, hide, duplicate, delete, list, magnet, Alt-key shortcuts | ✅ | |
| Drawings on price-driven types (Renko etc.) | ❌ by design | Anchors are (time, price); the chart says why they're hidden. |
| Drawing templates, favourites toolbar, Elliott / pattern / Gann tools | ❌ | Not built. |

### Traditorium Script (Pine Script®-style subset)

| Feature | Status | Notes |
|---|---|---|
| Lexer, parser, interpreter (`domain/scripting`) | ✅ | Compatibility table: `src/domain/scripting/README.md`. Unsupported v6 features are errors that name the feature. |
| Sandbox | ✅ | AST interpreter (never `eval`), Web Worker, 8 s timeout, step / loop / output caps. Never runs on the server. |
| Editor (CodeMirror 6): highlighting, autocomplete and hover help from the built-ins catalogue, live syntax errors, runtime errors on their line, Ctrl+S | ✅ | |
| Library: templates, rename, duplicate, archive, immutable versions, preview and restore-as-new-version, stale-save protection | ✅ | `UserScript` / `UserScriptVersion`. Source is stored as text; the server only matches `strategy(` to label the kind. |
| Scripts on charts (plots, histograms, shapes, hlines, bgcolor, barcolor, inputs dialog) | ✅ | Re-run after each replay step and after each save. |
| Strategy Tester | ✅ | Active chart's **real** candles (never synthetic types), up to 5,000, in the sandbox. Money uses the account's instrument point value. Labelled a study result, not an account result. |
| Strategy scripts placing orders on an account | ❌ deliberately | Would need a server-side sandboxed runtime so every order passes the execution and prop-rule services. Not done in the browser. |
| `request.security`, arrays / maps / matrices, UDTs, methods, `switch`, libraries, drawing objects (`line.new` …) | ❌ | Listed in the compatibility table. |

## 5. Script compatibility table

Maintained in `src/domain/scripting/README.md`.

## 6. Limits and data honesty

- Every chart, indicator, script and drawing is computed from candles the
  server already cut at the account clock; tests check that appending bars
  never changes earlier indicator or script values.
- MT5 M1 data: no ticks, no seconds, tick volume only. Nothing presents
  calculated (Heikin Ashi, Renko …) values as market prices, or tick volume
  as traded volume.
- Licensing: lightweight-charts (Apache-2.0, attribution logo kept),
  CodeMirror (MIT). No TradingView code, assets or branding. The
  "Pine Script®-style" wording is descriptive; legal review is recommended
  before marketing it.
