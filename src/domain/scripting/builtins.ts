/**
 * Catalogue of what Traditorium Script supports — drives editor autocomplete
 * and hover help. Keep in sync with runtime.ts and README.md (a test checks
 * that every function listed here is accepted by the runtime).
 */
export interface BuiltinDoc {
  name: string;
  kind: "function" | "variable" | "constant" | "keyword";
  signature?: string;
  doc: string;
}

const f = (name: string, signature: string, doc: string): BuiltinDoc => ({ name, kind: "function", signature, doc });
const v = (name: string, doc: string): BuiltinDoc => ({ name, kind: "variable", doc });
const c = (name: string, doc: string): BuiltinDoc => ({ name, kind: "constant", doc });

export const BUILTINS: BuiltinDoc[] = [
  f("indicator", 'indicator(title, overlay = false)', "Declares an indicator script. Must come first."),
  f("strategy", 'strategy(title, overlay = true, initial_capital = 10000, default_qty_type = strategy.fixed, default_qty_value = 1, commission_type = strategy.commission.percent, commission_value = 0)', "Declares a strategy script (results in the Strategy Tester; never places orders on an account)."),
  f("input", "input(defval, title)", "An input whose type follows its default value."),
  f("input.int", "input.int(defval, title, minval, maxval, step)", "Integer input."),
  f("input.float", "input.float(defval, title, minval, maxval, step)", "Decimal input."),
  f("input.bool", "input.bool(defval, title)", "On/off input."),
  f("input.string", "input.string(defval, title, options)", "Text input; `options` makes it a list."),
  f("input.source", "input.source(defval, title)", "Price source input (close, open, high, low, hl2, hlc3, ohlc4)."),
  f("input.color", "input.color(defval, title)", "Colour input."),
  f("plot", "plot(series, title, color, linewidth, style)", "Plots a series. style: plot.style_line, _histogram, _circles, _area, _columns, _stepline, _cross."),
  f("plotshape", "plotshape(series, title, style, location, color, text)", "Draws a shape on bars where `series` is true."),
  f("plotchar", "plotchar(series, title, char, location, color)", "Draws a character on bars where `series` is true."),
  f("hline", "hline(price, title, color)", "Horizontal reference line."),
  f("bgcolor", "bgcolor(color)", "Colours the chart background of the current bar."),
  f("barcolor", "barcolor(color)", "Colours the current bar."),
  f("fill", "fill(plot1, plot2, color)", "Accepted but not drawn yet."),
  f("alertcondition", "alertcondition(condition, title, message)", "Records bars where the condition is true (no notification is sent)."),
  f("alert", "alert(message)", "Records an alert on the current bar (no notification is sent)."),
  f("log.info", "log.info(message)", "Writes to the script console."),
  f("log.warning", "log.warning(message)", "Writes a warning to the script console."),
  f("log.error", "log.error(message)", "Writes an error to the script console."),
  f("na", "na(x)", "True when x is na."),
  f("nz", "nz(x, replacement = 0)", "Replaces na with `replacement`."),
  ...["abs", "max", "min", "avg", "sum", "round", "floor", "ceil", "sqrt", "pow", "log", "log10", "exp", "sign"].map((m) => f(`math.${m}`, `math.${m}(…)`, `Math function ${m}.`)),
  f("str.tostring", "str.tostring(value)", "Converts a value to text."),
  f("color.new", "color.new(color, transp)", "A colour with transparency 0–100."),
  f("color.rgb", "color.rgb(red, green, blue, transp = 0)", "A colour from RGB components."),
  f("ta.sma", "ta.sma(source, length)", "Simple moving average."),
  f("ta.ema", "ta.ema(source, length)", "Exponential moving average (SMA-seeded)."),
  f("ta.rma", "ta.rma(source, length)", "Wilder's moving average."),
  f("ta.wma", "ta.wma(source, length)", "Weighted moving average."),
  f("ta.vwma", "ta.vwma(source, length)", "Volume-weighted moving average (tick volume)."),
  f("ta.stdev", "ta.stdev(source, length)", "Population standard deviation."),
  f("ta.highest", "ta.highest(source, length)", "Highest value over `length` bars (high if source omitted)."),
  f("ta.lowest", "ta.lowest(source, length)", "Lowest value over `length` bars (low if source omitted)."),
  f("ta.change", "ta.change(source, length = 1)", "Difference from `length` bars ago."),
  f("ta.mom", "ta.mom(source, length)", "Momentum."),
  f("ta.roc", "ta.roc(source, length)", "Rate of change (%)."),
  f("ta.rsi", "ta.rsi(source, length)", "Relative Strength Index."),
  f("ta.cci", "ta.cci(source, length)", "Commodity Channel Index."),
  f("ta.tr", "ta.tr()", "True range."),
  f("ta.atr", "ta.atr(length)", "Average true range."),
  f("ta.stoch", "ta.stoch(source, high, low, length)", "Stochastic %K."),
  f("ta.macd", "ta.macd(source, fastlen, slowlen, siglen)", "Returns [macd, signal, histogram]."),
  f("ta.bb", "ta.bb(series, length, mult)", "Returns [basis, upper, lower]."),
  f("ta.dmi", "ta.dmi(diLength, adxSmoothing)", "Returns [+DI, −DI, ADX]."),
  f("ta.supertrend", "ta.supertrend(factor, atrPeriod)", "Returns [supertrend, direction]."),
  f("ta.vwap", "ta.vwap(source)", "VWAP anchored to the broker day (tick volume)."),
  f("ta.obv", "ta.obv()", "On-balance volume (tick volume)."),
  f("ta.crossover", "ta.crossover(a, b)", "a crossed above b on this bar."),
  f("ta.crossunder", "ta.crossunder(a, b)", "a crossed below b on this bar."),
  f("ta.cross", "ta.cross(a, b)", "a crossed b in either direction."),
  f("ta.cum", "ta.cum(source)", "Cumulative sum."),
  f("ta.barssince", "ta.barssince(condition)", "Bars since the condition was last true."),
  f("ta.valuewhen", "ta.valuewhen(condition, source, occurrence)", "Value of source when the condition was true."),
  f("ta.pivothigh", "ta.pivothigh(leftbars, rightbars)", "Pivot high, confirmed `rightbars` later (no lookahead)."),
  f("ta.pivotlow", "ta.pivotlow(leftbars, rightbars)", "Pivot low, confirmed `rightbars` later (no lookahead)."),
  f("strategy.entry", "strategy.entry(id, direction, qty, limit, stop)", "Enters (or reverses into) a position from the next bar."),
  f("strategy.exit", "strategy.exit(id, from_entry, stop, limit, loss, profit)", "Stop / target for an entry (loss/profit in ticks)."),
  f("strategy.close", "strategy.close(id)", "Closes the entry at the next bar's open."),
  f("strategy.close_all", "strategy.close_all()", "Closes everything at the next bar's open."),
  f("strategy.cancel", "strategy.cancel(id)", "Cancels a pending order."),
  f("strategy.cancel_all", "strategy.cancel_all()", "Cancels all pending orders."),
  ...["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4", "hlcc4"].map((n) => v(n, n === "volume" ? "Tick volume of the bar (MT5 data has no traded volume)." : `The bar's ${n}.`)),
  v("time", "Bar open time, broker wall clock, in ms."),
  v("bar_index", "Index of the current bar (0 = oldest loaded)."),
  v("last_bar_index", "Index of the last loaded bar."),
  v("hour", "Broker-clock hour of the bar."),
  v("minute", "Broker-clock minute of the bar."),
  v("dayofweek", "1 = Sunday … 7 = Saturday."),
  v("barstate.isfirst", "First bar."),
  v("barstate.islast", "Last loaded bar."),
  v("barstate.isconfirmed", "False on a still-forming replay bar."),
  v("barstate.ishistory", "Not the last bar."),
  v("strategy.position_size", "Signed position size (0 = flat)."),
  v("strategy.position_avg_price", "Average entry price."),
  v("strategy.equity", "Equity (cash + open P&L)."),
  v("strategy.netprofit", "Closed P&L."),
  v("strategy.openprofit", "Open P&L."),
  v("strategy.closedtrades", "Closed trade count."),
  c("strategy.long", "Long direction."),
  c("strategy.short", "Short direction."),
  ...["red", "green", "blue", "orange", "yellow", "purple", "teal", "aqua", "lime", "fuchsia", "maroon", "navy", "olive", "silver", "gray", "white", "black"].map((n) => c(`color.${n}`, `Colour ${n}.`)),
  ...["style_line", "style_histogram", "style_circles", "style_area", "style_columns", "style_stepline", "style_cross"].map((n) => c(`plot.${n}`, "Plot style.")),
  ...["triangleup", "triangledown", "arrowup", "arrowdown", "circle", "square", "diamond", "xcross", "cross", "labelup", "labeldown", "flag"].map((n) => c(`shape.${n}`, "Shape style.")),
  ...["abovebar", "belowbar", "absolute", "top", "bottom"].map((n) => c(`location.${n}`, "Shape location.")),
  v("syminfo.pointvalue", "Value of a 1.0 price move per lot/contract, in the quote currency (from the account's instrument specs; 1 if unknown)."),
  c("math.pi", "π"),
  ...["if", "else", "for", "to", "by", "while", "var", "varip", "true", "false", "and", "or", "not", "break", "continue", "na"].map((k): BuiltinDoc => ({ name: k, kind: "keyword", doc: "Keyword." })),
];

export const BUILTIN_BY_NAME = new Map(BUILTINS.map((b) => [b.name, b]));

export const SCRIPT_TEMPLATES: { key: string; label: string; source: string }[] = [
  {
    key: "indicator",
    label: "Indicator",
    source: `//@version=6
indicator("My indicator", overlay = true)
len = input.int(20, "Length", minval = 1)
basis = ta.ema(close, len)
plot(basis, "EMA", color = color.orange, linewidth = 2)
`,
  },
  {
    key: "oscillator",
    label: "Oscillator",
    source: `//@version=6
indicator("My oscillator", overlay = false)
len = input.int(14, "Length", minval = 2)
r = ta.rsi(close, len)
plot(r, "RSI", color = color.purple)
hline(70, "Overbought")
hline(30, "Oversold")
bgcolor(r > 70 ? color.new(color.red, 85) : r < 30 ? color.new(color.green, 85) : na)
`,
  },
  {
    key: "strategy",
    label: "Strategy",
    source: `//@version=6
strategy("MA cross", overlay = true, initial_capital = 10000, default_qty_value = 1)
fastLen = input.int(9, "Fast", minval = 1)
slowLen = input.int(21, "Slow", minval = 2)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast", color = color.teal)
plot(slow, "Slow", color = color.orange)
atr = ta.atr(14)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
if strategy.position_size > 0
    strategy.exit("XL", "Long", stop = strategy.position_avg_price - 2 * atr, limit = strategy.position_avg_price + 3 * atr)
if strategy.position_size < 0
    strategy.exit("XS", "Short", stop = strategy.position_avg_price + 2 * atr, limit = strategy.position_avg_price - 3 * atr)
`,
  },
];
