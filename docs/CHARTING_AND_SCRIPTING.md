# Charting Workspace & Scripting — Assessment and Plan

Companion to [SIMULATION_PLATFORM.md](./SIMULATION_PLATFORM.md) (which covers the
simulation domain, Strategy Lab and the Prop Firm Simulator — already built and
live). This document covers the charting workspace and the scripting runtime.
Written from the code at `75626c5`.

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
page), with an instruction budget, a loop-iteration cap, an array-size cap and
a wall-clock timeout; the server never executes scripts. Scripts only ever
receive the bars the chart already received — which the server already cut at
the replay clock — so a script cannot see the future.

Strategy scripts: run in the **Strategy Tester** against the revealed history
and produce a report (trades, equity, statistics). They do **not** place orders
on simulation accounts; doing so would need a server-side runtime so that
every order passes the account's execution and prop-firm rule services. That is
listed as future work rather than done unsafely in the browser.

## 4. Phases (this project)

| Phase | Deliverable |
|---|---|
| A | Indicator engine (pure, tested) and chart-type transforms (Heikin Ashi, Renko, Line Break, Kagi, Point & Figure, Range bars) |
| B | Script language: lexer, parser, interpreter, built-ins (`ta.*`, `math.*`, inputs, plots, strategy subset), worker sandbox, tests |
| C | Workspace: resizable/collapsible panels, focus mode, chart types, indicators in panes, chart settings, multi-chart layouts with sync, timeframe favourites, persistence per user |
| D | Script editor (CodeMirror 6): highlighting, autocomplete, diagnostics, script library with versions, add to chart, Strategy Tester |
| E | Drawings: simulation-account ownership, additional tools, templates; observations link drawings |

## 5. Script compatibility table

Maintained in `src/domain/scripting/README.md` as features land.
