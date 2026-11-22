# Traditorium Script

**Pine Script®-style syntax — a documented subset of Pine Script v6.** It is
*not* Pine Script and is not affiliated with or endorsed by TradingView. Most
simple v5/v6 indicators and strategies run unchanged; anything outside the
subset below fails with an error that names the missing feature — it is never
silently ignored or approximated.

> Pine Script® is a trademark of TradingView, Inc. Using the name to describe
> compatibility should be reviewed by counsel before public marketing.

## Compatibility level

**Partial (subset).** Measured honestly:

| Area | Status |
|---|---|
| `//@version=5/6`, `indicator()`, `strategy()` | ✅ |
| Indentation blocks, line continuation, comments | ✅ |
| `var` (global), `varip` (treated as `var` — no intrabar ticks exist) | ✅ / ⚠️ |
| `var` inside functions / local blocks | ❌ error |
| Type qualifiers (`int`, `float`, `series`, `simple`…) | ✅ accepted, not type-checked |
| `if / else if / else` (statement and expression), ternary | ✅ |
| `for i = a to b [by s]`, `while`, `break`, `continue` | ✅ (100 000 iterations / loop) |
| `for … in`, `switch`, `type`, `method`, `enum`, `import`/`export` | ❌ error |
| User functions (`f(x, n = 2) =>`), single/multi-line, tuple returns | ✅ |
| History `x[n]` on globals, built-in series and any expression | ✅ |
| History on local (function/block) variables | ❌ error |
| Arrays, matrices, maps | ❌ error |
| `request.security` / other timeframes / other symbols | ❌ error |
| Drawing objects (`label.*`, `line.*`, `box.*`, `table.*`, `polyline.*`) | ❌ error |
| `plot` (line, histogram, circles, area, columns, stepline, cross), `hline`, `bgcolor`, `barcolor`, `plotshape`, `plotchar` | ✅ |
| `fill` | ⚠️ accepted, not drawn yet |
| `input`, `input.int/float/bool/string/source/color` (min/max/step/options) | ✅ |
| `alertcondition`, `alert`, `log.*` | ✅ recorded in results (no notifications sent) |
| Colors: `color.*` constants, `#RRGGBB[AA]`, `color.new`, `color.rgb` | ✅ |
| `math.*` (abs, min, max, avg, sum, round, floor, ceil, sqrt, pow, log, log10, exp, sign, pi, e) | ✅ |
| `str.tostring` | ✅ (other `str.*` ❌) |
| `na`, `nz`, `na()` | ✅ |
| `ta.sma ema rma wma vwma stdev highest lowest change mom roc rsi cci tr atr stoch macd bb dmi supertrend vwap obv crossover crossunder cross cum barssince valuewhen pivothigh pivotlow` | ✅ |
| Other `ta.*` | ❌ error |
| `barstate.isfirst/islast/isconfirmed/ishistory`, `bar_index`, `last_bar_index`, `time`, `hour`, `minute`, `dayofweek` | ✅ (broker wall-clock) |
| `strategy.entry` (market / limit / stop), `strategy.exit` (stop, limit, loss/profit in ticks), `strategy.close`, `strategy.close_all`, `strategy.cancel`, `strategy.cancel_all` | ✅ |
| `strategy.position_size`, `position_avg_price`, `equity`, `netprofit`, `openprofit`, `closedtrades`, `opentrades`, `wintrades`, `losstrades` | ✅ |
| Pyramiding > 1, partial exits (`qty_percent`), trailing stops, OCA groups, `strategy.order`, margin calls | ❌ not simulated |
| `calc_on_every_tick`, `process_orders_on_close`, bar magnifier | ❌ not supported |

## Execution model

* The script runs once per bar, oldest first. A value at bar *i* depends only
  on bars ≤ *i* (tested: appending bars never changes earlier outputs).
* Stateful built-ins (`ta.*`) keep separate state per call site, including
  through user functions — as in Pine.
* In replay the last bar may be forming: `barstate.isconfirmed` is false
  there and strategy orders placed on it are never filled.
* `time` is broker wall-clock (no timezone), in milliseconds.

## Strategy Tester semantics

* One net position. Orders placed on bar *i* are processed from bar *i+1*:
  market orders fill at that bar's open; stop/limit orders fill when touched
  (at the open if the bar gaps through the level).
* If a bar touches both an exit's stop and its limit, the **stop** fills
  (OHLC can't tell which came first — conservative).
* P&L = price difference × quantity (no contract size or currency
  conversion). Commission: percent of value, cash per order or per contract.
* **Strategy scripts never place orders on a simulation account.** They run
  in the Strategy Tester only, on the candles you have already seen. They
  can't bypass Prop Firm Simulator rules because they never reach an account.

## Security

* Source is tokenised and parsed into an AST and interpreted — it is never
  turned into JavaScript or passed to `eval`/`Function`.
* The interpreter has no I/O: no network, storage, DOM or app state.
* In the browser it runs in a dedicated Web Worker that is terminated after
  8 seconds.
* Limits: 20 M interpreter steps per run, 100 000 iterations per loop,
  64 plots, 5 000 shapes, 1 000 log lines, 4 096-char strings, 50 000 bars,
  64-deep user-function recursion.
* Scripts never run in the application server process.
