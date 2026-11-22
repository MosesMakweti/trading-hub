/**
 * Chart-type transforms — each a genuine calculation, not a restyle.
 *
 * Input: ordinary OHLC candles (any timeframe). Output: candles to render.
 * Heikin Ashi keeps one candle per input candle. Renko, Line Break, Kagi,
 * Point & Figure and Range bars are PRICE-driven: a brick/column appears only
 * when price moves enough, so they have no natural time axis. Each output
 * candle carries the time of the input candle that completed it; when one
 * input candle completes several bricks they get consecutive synthetic
 * seconds inside that minute so the axis stays strictly increasing.
 *
 * Every output is marked `synthetic` (except Heikin Ashi's open/close which
 * are also synthetic — flagged too) so the UI can say these are not market
 * prices. Only completed bricks are emitted for brick types: the last,
 * still-forming input candle can't create a brick that later disappears…
 * except Range bars, whose current bar is forming by definition and is
 * marked `forming`.
 */

export interface OhlcCandle {
  /** Wall-clock minute of the candle's open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartCandle {
  /** Chart time in seconds (minute × 60 + synthetic offset). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Minute of the market candle this output came from. */
  sourceMinute: number;
  synthetic: boolean;
  forming?: boolean;
}

export type ChartTypeKey = "candles" | "hollow" | "bars" | "line" | "area" | "baseline" | "heikinashi" | "renko" | "linebreak" | "kagi" | "pointfigure" | "range";

export const CHART_TYPES: { key: ChartTypeKey; label: string; synthetic: boolean; param?: { label: string; kind: "price" | "count"; default: "auto" | number } }[] = [
  { key: "candles", label: "Candles", synthetic: false },
  { key: "hollow", label: "Hollow candles", synthetic: false },
  { key: "bars", label: "Bars (OHLC)", synthetic: false },
  { key: "line", label: "Line", synthetic: false },
  { key: "area", label: "Area", synthetic: false },
  { key: "baseline", label: "Baseline", synthetic: false },
  { key: "heikinashi", label: "Heikin Ashi", synthetic: true },
  { key: "renko", label: "Renko", synthetic: true, param: { label: "Box size", kind: "price", default: "auto" } },
  { key: "linebreak", label: "Line break", synthetic: true, param: { label: "Lines", kind: "count", default: 3 } },
  { key: "kagi", label: "Kagi", synthetic: true, param: { label: "Reversal", kind: "price", default: "auto" } },
  { key: "pointfigure", label: "Point & figure", synthetic: true, param: { label: "Box size", kind: "price", default: "auto" } },
  { key: "range", label: "Range bars", synthetic: true, param: { label: "Range", kind: "price", default: "auto" } },
];

const at = (minute: number, k: number) => minute * 60 + Math.min(k, 59);

/** Passes market candles through unchanged (for the non-synthetic types). */
export function plain(candles: OhlcCandle[]): ChartCandle[] {
  return candles.map((c) => ({ ...c, time: c.time * 60, sourceMinute: c.time, synthetic: false }));
}

export function heikinAshi(candles: OhlcCandle[]): ChartCandle[] {
  const out: ChartCandle[] = [];
  let prevOpen = NaN;
  let prevClose = NaN;
  for (const c of candles) {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = Number.isFinite(prevOpen) ? (prevOpen + prevClose) / 2 : (c.open + c.close) / 2;
    out.push({ time: c.time * 60, open, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close), close, sourceMinute: c.time, synthetic: true });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

/**
 * Renko on closes: a new brick each time the close moves one box beyond the
 * last brick; a reversal needs two boxes (the classic rule).
 */
export function renko(candles: OhlcCandle[], box: number): ChartCandle[] {
  if (!(box > 0) || candles.length === 0) return [];
  const out: ChartCandle[] = [];
  let base = Math.round(candles[0].close / box) * box;
  let dir = 0;
  for (const c of candles) {
    let k = 0;
    for (;;) {
      if (c.close >= base + box * (dir === -1 ? 2 : 1)) {
        const open = dir === -1 ? base + box : base;
        out.push({ time: at(c.time, k++), open, high: open + box, low: open, close: open + box, sourceMinute: c.time, synthetic: true });
        base = open + box;
        dir = 1;
      } else if (c.close <= base - box * (dir === 1 ? 2 : 1)) {
        const open = dir === 1 ? base - box : base;
        out.push({ time: at(c.time, k++), open, high: open, low: open - box, close: open - box, sourceMinute: c.time, synthetic: true });
        base = open - box;
        dir = -1;
      } else break;
    }
  }
  return dedupeTimes(out);
}

/** N-line break: a new line when the close exceeds the extreme of the last N lines (reversal) or extends the trend. */
export function lineBreak(candles: OhlcCandle[], lines = 3): ChartCandle[] {
  const out: ChartCandle[] = [];
  for (const c of candles) {
    if (out.length === 0) {
      if (candles.length && c.close !== c.open) out.push({ time: c.time * 60, open: c.open, high: Math.max(c.open, c.close), low: Math.min(c.open, c.close), close: c.close, sourceMinute: c.time, synthetic: true });
      continue;
    }
    const last = out[out.length - 1];
    const up = last.close > last.open;
    const recent = out.slice(-lines);
    const hi = Math.max(...recent.map((l) => l.high));
    const lo = Math.min(...recent.map((l) => l.low));
    let open: number | null = null;
    if (up && c.close > last.close) open = last.close;
    else if (!up && c.close < last.close) open = last.close;
    else if (up && c.close < lo) open = last.open;
    else if (!up && c.close > hi) open = last.open;
    if (open != null) out.push({ time: c.time * 60, open, high: Math.max(open, c.close), low: Math.min(open, c.close), close: c.close, sourceMinute: c.time, synthetic: true });
  }
  return out;
}

/**
 * Kagi on closes: the line continues in its direction; it reverses when the
 * close moves `reversal` against the current extreme. Each output candle is
 * one vertical Kagi segment (open → close).
 */
export function kagi(candles: OhlcCandle[], reversal: number): ChartCandle[] {
  if (!(reversal > 0) || candles.length === 0) return [];
  const out: ChartCandle[] = [];
  let start = candles[0].close;
  let extreme = start;
  let dir = 0;
  let segMinute = candles[0].time;
  const push = (end: number, minute: number) => out.push({ time: minute * 60, open: start, high: Math.max(start, end), low: Math.min(start, end), close: end, sourceMinute: minute, synthetic: true });
  for (const c of candles.slice(1)) {
    const p = c.close;
    if (dir === 0) {
      if (Math.abs(p - start) >= reversal) {
        dir = p > start ? 1 : -1;
        extreme = p;
        segMinute = c.time;
      }
    } else if ((dir === 1 && p > extreme) || (dir === -1 && p < extreme)) {
      extreme = p;
      segMinute = c.time;
    } else if ((dir === 1 && extreme - p >= reversal) || (dir === -1 && p - extreme >= reversal)) {
      push(extreme, segMinute);
      start = extreme;
      extreme = p;
      dir = -dir;
      segMinute = c.time;
    }
  }
  return dedupeTimes(out);
}

/**
 * Point & Figure on high/low with a box size and an N-box reversal (default 3).
 * Each output candle is one column: rising X column (open < close) or falling
 * O column. Only completed columns are emitted, plus the current one marked
 * forming.
 */
export function pointFigure(candles: OhlcCandle[], box: number, reversalBoxes = 3): ChartCandle[] {
  if (!(box > 0) || candles.length === 0) return [];
  const out: ChartCandle[] = [];
  const snap = (p: number) => Math.floor(p / box) * box;
  let dir = 0;
  let colLow = snap(candles[0].low);
  let colHigh = colLow + box;
  let minute = candles[0].time;
  const close = () => out.push({ time: minute * 60, open: dir === 1 ? colLow : colHigh, high: colHigh, low: colLow, close: dir === 1 ? colHigh : colLow, sourceMinute: minute, synthetic: true });
  for (const c of candles) {
    const hi = snap(c.high);
    const lo = Math.ceil(c.low / box) * box;
    if (dir >= 0 && hi >= colHigh + box) {
      colHigh = hi;
      dir = 1;
      minute = c.time;
    } else if (dir <= 0 && lo <= colLow - box) {
      colLow = lo;
      dir = -1;
      minute = c.time;
    } else if (dir === 1 && lo <= colHigh - reversalBoxes * box) {
      close();
      colHigh = colHigh - box;
      colLow = lo;
      dir = -1;
      minute = c.time;
    } else if (dir === -1 && hi >= colLow + reversalBoxes * box) {
      close();
      colLow = colLow + box;
      colHigh = hi;
      dir = 1;
      minute = c.time;
    }
  }
  if (dir !== 0) {
    close();
    out[out.length - 1].forming = true;
  }
  return dedupeTimes(out);
}

/** Range bars: each bar spans exactly `range` from its open; a new bar starts when the range is exceeded. */
export function rangeBars(candles: OhlcCandle[], range: number): ChartCandle[] {
  if (!(range > 0) || candles.length === 0) return [];
  const out: ChartCandle[] = [];
  let cur: ChartCandle | null = null;
  let k = 0;
  let lastMinute = NaN;
  for (const c of candles) {
    if (c.time !== lastMinute) k = 0;
    lastMinute = c.time;
    // Walk the candle's path as open → nearer extreme → farther extreme → close (an assumption, flagged synthetic).
    const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
    for (const p of path) {
      if (!cur) cur = { time: at(c.time, k++), open: p, high: p, low: p, close: p, sourceMinute: c.time, synthetic: true, forming: true };
      let price = p;
      while (Math.max(cur.high, price) - Math.min(cur.low, price) > range) {
        const up = price > cur.open;
        const end = up ? cur.low + range : cur.high - range;
        cur.high = Math.max(cur.high, end);
        cur.low = Math.min(cur.low, end);
        cur.close = end;
        cur.forming = false;
        out.push(cur);
        cur = { time: at(c.time, k++), open: end, high: end, low: end, close: end, sourceMinute: c.time, synthetic: true, forming: true };
        price = p;
      }
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
    }
  }
  if (cur) out.push(cur);
  return dedupeTimes(out);
}

/** Guarantees strictly increasing chart times (bricks from the same minute already have offsets). */
function dedupeTimes(list: ChartCandle[]): ChartCandle[] {
  for (let i = 1; i < list.length; i++) if (list[i].time <= list[i - 1].time) list[i].time = list[i - 1].time + 1;
  return list;
}

/** A sensible default box: ~ the median true range of the input, rounded to the price's precision. */
export function autoBoxSize(candles: OhlcCandle[], priceScale: number): number {
  const ranges = candles.map((c) => c.high - c.low).filter((r) => r > 0).sort((a, b) => a - b);
  const tick = 10 ** -priceScale;
  if (ranges.length === 0) return tick * 10;
  const median = ranges[Math.floor(ranges.length / 2)];
  return Math.max(tick, Math.round(median / tick) * tick);
}

export function transform(type: ChartTypeKey, candles: OhlcCandle[], param: number | null, priceScale: number): ChartCandle[] {
  const p = param ?? (type === "linebreak" ? 3 : autoBoxSize(candles, priceScale));
  switch (type) {
    case "heikinashi": return heikinAshi(candles);
    case "renko": return renko(candles, p);
    case "linebreak": return lineBreak(candles, Math.max(1, Math.round(p)));
    case "kagi": return kagi(candles, p);
    case "pointfigure": return pointFigure(candles, p);
    case "range": return rangeBars(candles, p);
    default: return plain(candles);
  }
}
