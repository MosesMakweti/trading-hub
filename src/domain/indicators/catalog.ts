/**
 * Built-in indicator catalog — definitions the chart (and the script
 * runtime's `ta.*`) share. Each indicator declares typed inputs, its plots
 * (line / histogram / band, overlaid on price or in its own pane) and a pure
 * `compute(bars, inputs)`.
 *
 * Volume: MT5 exports carry TICK volume (number of price changes), not traded
 * volume. Volume-weighted indicators (VWAP, VWMA, OBV) therefore use tick
 * volume and say so in their description.
 */
import * as ta from "./ta";

export interface IndicatorBar {
  /** Broker wall-clock minute of the candle's open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type InputDef =
  | { key: string; label: string; type: "int"; default: number; min: number; max: number }
  | { key: string; label: string; type: "float"; default: number; min: number; max: number; step: number }
  | { key: string; label: string; type: "source"; default: SourceKey };

export type SourceKey = "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";

export interface PlotDef {
  key: string;
  label: string;
  kind: "line" | "histogram" | "dots";
  color: string;
}

export interface IndicatorDef {
  id: string;
  name: string;
  category: "Moving averages" | "Bands & channels" | "Oscillators" | "Trend" | "Volume" | "Levels";
  description: string;
  /** Drawn on the price pane (true) or in its own pane. */
  overlay: boolean;
  inputs: InputDef[];
  plots: PlotDef[];
  /** Horizontal reference levels for separate panes (e.g. RSI 30/70). */
  levels?: number[];
  /** Fill between two plots (band indicators). */
  fill?: [string, string];
  compute: (bars: IndicatorBar[], inputs: Record<string, number | string>) => Record<string, ta.Series>;
}

export function sourceOf(bars: IndicatorBar[], key: SourceKey): ta.Series {
  switch (key) {
    case "open": return bars.map((b) => b.open);
    case "high": return bars.map((b) => b.high);
    case "low": return bars.map((b) => b.low);
    case "hl2": return bars.map((b) => (b.high + b.low) / 2);
    case "hlc3": return bars.map((b) => (b.high + b.low + b.close) / 3);
    case "ohlc4": return bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
    default: return bars.map((b) => b.close);
  }
}

const len = (key = "length", def = 14, label = "Length"): InputDef => ({ key, label, type: "int", default: def, min: 1, max: 500 });
const src = (def: SourceKey = "close"): InputDef => ({ key: "source", label: "Source", type: "source", default: def });
const n = (v: number | string) => Number(v);
const col = { blue: "#2962ff", orange: "#ff9800", purple: "#9c27b0", teal: "#26a69a", red: "#ef5350", gray: "#787b86", green: "#4caf50", yellow: "#fbc02d" };

function ma(id: string, name: string, f: (s: ta.Series, l: number, b: IndicatorBar[]) => ta.Series, description: string): IndicatorDef {
  return {
    id, name, category: "Moving averages", description, overlay: true,
    inputs: [len("length", 20), src()],
    plots: [{ key: "ma", label: name, kind: "line", color: col.blue }],
    compute: (bars, i) => ({ ma: f(sourceOf(bars, i.source as SourceKey), n(i.length), bars) }),
  };
}

/** Broker trading-day index of a minute (00:00 reset) — for daily anchoring. */
const dayOf = (minute: number) => Math.floor(minute / 1440);

export const INDICATORS: IndicatorDef[] = [
  ma("sma", "SMA", (s, l) => ta.sma(s, l), "Simple moving average."),
  ma("ema", "EMA", (s, l) => ta.ema(s, l), "Exponential moving average (seeded with the SMA)."),
  ma("wma", "WMA", (s, l) => ta.wma(s, l), "Linearly weighted moving average."),
  ma("vwma", "VWMA", (s, l, b) => ta.vwma(s, b.map((x) => x.volume), l), "Volume-weighted moving average (tick volume)."),
  {
    id: "bb", name: "Bollinger Bands", category: "Bands & channels", description: "SMA ± k standard deviations.", overlay: true,
    inputs: [len("length", 20), { key: "mult", label: "StdDev", type: "float", default: 2, min: 0.1, max: 10, step: 0.1 }, src()],
    plots: [{ key: "basis", label: "Basis", kind: "line", color: col.orange }, { key: "upper", label: "Upper", kind: "line", color: col.blue }, { key: "lower", label: "Lower", kind: "line", color: col.blue }],
    fill: ["upper", "lower"],
    compute: (bars, i) => {
      const s = sourceOf(bars, i.source as SourceKey);
      const basis = ta.sma(s, n(i.length));
      const dev = ta.stdev(s, n(i.length));
      return { basis, upper: basis.map((b, k) => b + n(i.mult) * dev[k]), lower: basis.map((b, k) => b - n(i.mult) * dev[k]) };
    },
  },
  {
    id: "donchian", name: "Donchian Channels", category: "Bands & channels", description: "Highest high and lowest low over the period.", overlay: true,
    inputs: [len("length", 20)],
    plots: [{ key: "upper", label: "Upper", kind: "line", color: col.blue }, { key: "basis", label: "Basis", kind: "line", color: col.orange }, { key: "lower", label: "Lower", kind: "line", color: col.blue }],
    fill: ["upper", "lower"],
    compute: (bars, i) => {
      const u = ta.highest(bars.map((b) => b.high), n(i.length));
      const l = ta.lowest(bars.map((b) => b.low), n(i.length));
      return { upper: u, lower: l, basis: u.map((v, k) => (v + l[k]) / 2) };
    },
  },
  {
    id: "keltner", name: "Keltner Channels", category: "Bands & channels", description: "EMA ± k × ATR.", overlay: true,
    inputs: [len("length", 20), { key: "mult", label: "Multiplier", type: "float", default: 2, min: 0.1, max: 10, step: 0.1 }, len("atrLength", 10, "ATR length")],
    plots: [{ key: "upper", label: "Upper", kind: "line", color: col.blue }, { key: "basis", label: "Basis", kind: "line", color: col.orange }, { key: "lower", label: "Lower", kind: "line", color: col.blue }],
    fill: ["upper", "lower"],
    compute: (bars, i) => {
      const basis = ta.ema(bars.map((b) => b.close), n(i.length));
      const a = ta.atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), n(i.atrLength));
      return { basis, upper: basis.map((b, k) => b + n(i.mult) * a[k]), lower: basis.map((b, k) => b - n(i.mult) * a[k]) };
    },
  },
  {
    id: "vwap", name: "VWAP", category: "Volume", description: "Volume-weighted average price, reset each broker-clock day (tick volume).", overlay: true,
    inputs: [src("hlc3")],
    plots: [{ key: "vwap", label: "VWAP", kind: "line", color: col.purple }],
    compute: (bars, i) => ({ vwap: ta.vwap(sourceOf(bars, i.source as SourceKey), bars.map((b) => b.volume), bars.map((b) => dayOf(b.time))) }),
  },
  {
    id: "supertrend", name: "Supertrend", category: "Trend", description: "ATR trailing stop that flips with the trend.", overlay: true,
    inputs: [len("atrPeriod", 10, "ATR length"), { key: "factor", label: "Factor", type: "float", default: 3, min: 0.1, max: 20, step: 0.1 }],
    plots: [{ key: "up", label: "Up trend", kind: "line", color: col.green }, { key: "down", label: "Down trend", kind: "line", color: col.red }],
    compute: (bars, i) => {
      const { line, direction } = ta.supertrend(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), n(i.factor), n(i.atrPeriod));
      return { up: line.map((v, k) => (direction[k] < 0 ? v : NaN)), down: line.map((v, k) => (direction[k] > 0 ? v : NaN)) };
    },
  },
  {
    id: "ichimoku", name: "Ichimoku Cloud", category: "Trend", description: "Conversion, base, leading spans and lagging span. Leading spans are shifted forward by drawing them at later bars only once those bars exist.", overlay: true,
    inputs: [len("conversion", 9, "Conversion"), len("base", 26, "Base"), len("spanB", 52, "Leading span B"), len("displacement", 26, "Displacement")],
    plots: [
      { key: "conversion", label: "Conversion", kind: "line", color: col.blue },
      { key: "base", label: "Base", kind: "line", color: col.red },
      { key: "spanA", label: "Leading A", kind: "line", color: col.green },
      { key: "spanB", label: "Leading B", kind: "line", color: col.red },
      { key: "lagging", label: "Lagging", kind: "line", color: col.gray },
    ],
    fill: ["spanA", "spanB"],
    compute: (bars, i) => {
      const h = bars.map((b) => b.high);
      const l = bars.map((b) => b.low);
      const mid = (p: number) => {
        const lo = ta.lowest(l, p); // once per length — not once per bar (that was O(n²))
        return ta.highest(h, p).map((v, k) => (v + lo[k]) / 2);
      };
      const conv = mid(n(i.conversion));
      const base = mid(n(i.base));
      const d = n(i.displacement) - 1;
      const a = conv.map((v, k) => (v + base[k]) / 2);
      const b = mid(n(i.spanB));
      const shift = (s: ta.Series) => s.map((_, k) => (k - d >= 0 ? s[k - d] : NaN));
      // The lagging span plots today's close d bars back — known now, never future data.
      const lagging = bars.map((_, k) => (k + d < bars.length ? bars[k + d].close : NaN));
      return { conversion: conv, base, spanA: shift(a), spanB: shift(b), lagging };
    },
  },
  {
    id: "pivots", name: "Pivot Points (daily)", category: "Levels", description: "Classic pivots from the previous broker-clock day's high, low and close.", overlay: true,
    inputs: [],
    plots: ["P", "R1", "S1", "R2", "S2"].map((k, idx) => ({ key: k, label: k, kind: "dots" as const, color: idx === 0 ? col.orange : k.startsWith("R") ? col.red : col.green })),
    compute: (bars) => {
      const out: Record<string, ta.Series> = { P: [], R1: [], S1: [], R2: [], S2: [] };
      let prev: { h: number; l: number; c: number } | null = null;
      let cur: { h: number; l: number; c: number } | null = null;
      let day = NaN;
      for (const b of bars) {
        const d = dayOf(b.time);
        if (d !== day) {
          prev = cur;
          cur = { h: b.high, l: b.low, c: b.close };
          day = d;
        } else if (cur) {
          cur.h = Math.max(cur.h, b.high);
          cur.l = Math.min(cur.l, b.low);
          cur.c = b.close;
        }
        if (!prev) {
          for (const k of Object.keys(out)) out[k].push(NaN);
          continue;
        }
        const p = (prev.h + prev.l + prev.c) / 3;
        out.P.push(p);
        out.R1.push(2 * p - prev.l);
        out.S1.push(2 * p - prev.h);
        out.R2.push(p + (prev.h - prev.l));
        out.S2.push(p - (prev.h - prev.l));
      }
      return out;
    },
  },
  {
    id: "rsi", name: "RSI", category: "Oscillators", description: "Relative strength index (Wilder).", overlay: false,
    inputs: [len("length", 14), src()], plots: [{ key: "rsi", label: "RSI", kind: "line", color: col.purple }], levels: [30, 50, 70],
    compute: (bars, i) => ({ rsi: ta.rsi(sourceOf(bars, i.source as SourceKey), n(i.length)) }),
  },
  {
    id: "macd", name: "MACD", category: "Oscillators", description: "EMA difference, signal line and histogram.", overlay: false,
    inputs: [len("fast", 12, "Fast"), len("slow", 26, "Slow"), len("signal", 9, "Signal"), src()],
    plots: [{ key: "histogram", label: "Histogram", kind: "histogram", color: col.teal }, { key: "macd", label: "MACD", kind: "line", color: col.blue }, { key: "signal", label: "Signal", kind: "line", color: col.orange }],
    levels: [0],
    compute: (bars, i) => ta.macd(sourceOf(bars, i.source as SourceKey), n(i.fast), n(i.slow), n(i.signal)),
  },
  {
    id: "stoch", name: "Stochastic", category: "Oscillators", description: "%K smoothed, and its %D.", overlay: false,
    inputs: [len("kLength", 14, "%K length"), len("kSmooth", 1, "%K smoothing"), len("dLength", 3, "%D smoothing")],
    plots: [{ key: "k", label: "%K", kind: "line", color: col.blue }, { key: "d", label: "%D", kind: "line", color: col.orange }], levels: [20, 80],
    compute: (bars, i) => {
      const k = ta.sma(ta.stoch(bars.map((b) => b.close), bars.map((b) => b.high), bars.map((b) => b.low), n(i.kLength)), n(i.kSmooth));
      return { k, d: ta.sma(k, n(i.dLength)) };
    },
  },
  {
    id: "atr", name: "ATR", category: "Oscillators", description: "Average true range (Wilder).", overlay: false,
    inputs: [len("length", 14)], plots: [{ key: "atr", label: "ATR", kind: "line", color: col.red }],
    compute: (bars, i) => ({ atr: ta.atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), n(i.length)) }),
  },
  {
    id: "adx", name: "ADX / DMI", category: "Trend", description: "Average directional index with +DI and −DI.", overlay: false,
    inputs: [len("diLength", 14, "DI length"), len("adxSmoothing", 14, "ADX smoothing")],
    plots: [{ key: "adx", label: "ADX", kind: "line", color: col.red }, { key: "plus", label: "+DI", kind: "line", color: col.blue }, { key: "minus", label: "−DI", kind: "line", color: col.orange }],
    compute: (bars, i) => ta.dmi(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), n(i.diLength), n(i.adxSmoothing)),
  },
  {
    id: "cci", name: "CCI", category: "Oscillators", description: "Commodity channel index.", overlay: false,
    inputs: [len("length", 20), src("hlc3")], plots: [{ key: "cci", label: "CCI", kind: "line", color: col.blue }], levels: [-100, 0, 100],
    compute: (bars, i) => ({ cci: ta.cci(sourceOf(bars, i.source as SourceKey), n(i.length)) }),
  },
  {
    id: "willr", name: "Williams %R", category: "Oscillators", description: "Position of the close within the period's range.", overlay: false,
    inputs: [len("length", 14)], plots: [{ key: "r", label: "%R", kind: "line", color: col.purple }], levels: [-80, -20],
    compute: (bars, i) => ({ r: ta.williamsR(bars.map((b) => b.close), bars.map((b) => b.high), bars.map((b) => b.low), n(i.length)) }),
  },
  {
    id: "mom", name: "Momentum", category: "Oscillators", description: "Price change over the period.", overlay: false,
    inputs: [len("length", 10), src()], plots: [{ key: "mom", label: "Momentum", kind: "line", color: col.blue }], levels: [0],
    compute: (bars, i) => ({ mom: ta.mom(sourceOf(bars, i.source as SourceKey), n(i.length)) }),
  },
  {
    id: "roc", name: "Rate of Change", category: "Oscillators", description: "Percentage change over the period.", overlay: false,
    inputs: [len("length", 9), src()], plots: [{ key: "roc", label: "ROC", kind: "line", color: col.blue }], levels: [0],
    compute: (bars, i) => ({ roc: ta.roc(sourceOf(bars, i.source as SourceKey), n(i.length)) }),
  },
  {
    id: "obv", name: "On-Balance Volume", category: "Volume", description: "Cumulative tick volume signed by the close's direction.", overlay: false,
    inputs: [], plots: [{ key: "obv", label: "OBV", kind: "line", color: col.blue }],
    compute: (bars) => ({ obv: ta.obv(bars.map((b) => b.close), bars.map((b) => b.volume)) }),
  },
  {
    id: "volume", name: "Volume", category: "Volume", description: "Tick volume per candle (MT5 exports have no traded volume).", overlay: false,
    inputs: [len("maLength", 20, "MA length")],
    plots: [{ key: "volume", label: "Volume", kind: "histogram", color: col.gray }, { key: "ma", label: "MA", kind: "line", color: col.blue }],
    compute: (bars, i) => {
      const v = bars.map((b) => b.volume);
      return { volume: v, ma: ta.sma(v, n(i.maLength)) };
    },
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export function defaultInputs(def: IndicatorDef): Record<string, number | string> {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
}

/** Validates and clamps user inputs against the definition (unknown keys dropped). */
export function sanitizeInputs(def: IndicatorDef, raw: Record<string, unknown>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const i of def.inputs) {
    const v = raw[i.key];
    if (i.type === "source") {
      out[i.key] = typeof v === "string" && ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"].includes(v) ? v : i.default;
    } else {
      const num = Number(v);
      const val = Number.isFinite(num) ? Math.min(i.max, Math.max(i.min, num)) : i.default;
      out[i.key] = i.type === "int" ? Math.round(val) : val;
    }
  }
  return out;
}
