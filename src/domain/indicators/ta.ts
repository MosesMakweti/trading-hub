/**
 * Technical-analysis primitives — pure, deterministic, bar-indexed.
 *
 * Every function takes series as number arrays (oldest first) and returns a
 * series of the same length; `NaN` means "not available yet" (Pine's `na`).
 * A value at index i depends only on inputs at indices ≤ i — no function ever
 * looks ahead, so the same code serves the chart, the script runtime and
 * replay (where the last bar may still be forming).
 *
 * Seeding follows the documented Pine conventions so results match what
 * traders expect: EMA and RMA start from the SMA of the first `length`
 * values; RSI and ATR use RMA (Wilder smoothing).
 */

export type Series = number[];

const isNum = (v: number) => Number.isFinite(v);

export function nz(v: number, replacement = 0): number {
  return isNum(v) ? v : replacement;
}

export function sma(src: Series, length: number): Series {
  const out = new Array<number>(src.length).fill(NaN);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (isNum(v)) {
      sum += v;
      valid++;
    }
    if (i >= length) {
      const old = src[i - length];
      if (isNum(old)) {
        sum -= old;
        valid--;
      }
    }
    if (i >= length - 1 && valid === length) out[i] = sum / length;
  }
  return out;
}

/** Exponential smoothing with a given alpha, seeded by the SMA of the first `length` values. */
function smoothed(src: Series, length: number, alpha: number): Series {
  const out = new Array<number>(src.length).fill(NaN);
  const seed = sma(src, length);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (!isNum(prev)) {
      if (isNum(seed[i])) prev = seed[i];
    } else if (isNum(src[i])) {
      prev = alpha * src[i] + (1 - alpha) * prev;
    }
    out[i] = prev;
  }
  return out;
}

export const ema = (src: Series, length: number) => smoothed(src, length, 2 / (length + 1));
/** Wilder's moving average (RMA), alpha = 1/length. */
export const rma = (src: Series, length: number) => smoothed(src, length, 1 / length);

export function wma(src: Series, length: number): Series {
  const out = new Array<number>(src.length).fill(NaN);
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < src.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = src[i - k];
      if (!isNum(v)) {
        ok = false;
        break;
      }
      s += v * (length - k);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

export function vwma(src: Series, volume: Series, length: number): Series {
  const pv = src.map((v, i) => v * volume[i]);
  const a = sma(pv, length);
  const b = sma(volume, length);
  return a.map((v, i) => (b[i] ? v / b[i] : NaN));
}

export function stdev(src: Series, length: number): Series {
  const mean = sma(src, length);
  return mean.map((m, i) => {
    if (!isNum(m)) return NaN;
    let s = 0;
    for (let k = 0; k < length; k++) s += (src[i - k] - m) ** 2;
    return Math.sqrt(s / length); // population standard deviation, as Pine's ta.stdev (biased)
  });
}

export function highest(src: Series, length: number): Series {
  return src.map((_, i) => {
    if (i < length - 1) return NaN;
    let m = -Infinity;
    for (let k = 0; k < length; k++) m = Math.max(m, src[i - k]);
    return isNum(m) ? m : NaN;
  });
}

export function lowest(src: Series, length: number): Series {
  return src.map((_, i) => {
    if (i < length - 1) return NaN;
    let m = Infinity;
    for (let k = 0; k < length; k++) m = Math.min(m, src[i - k]);
    return isNum(m) ? m : NaN;
  });
}

export function change(src: Series, length = 1): Series {
  return src.map((v, i) => (i >= length ? v - src[i - length] : NaN));
}

export function mom(src: Series, length: number): Series {
  return change(src, length);
}

export function roc(src: Series, length: number): Series {
  return src.map((v, i) => (i >= length && src[i - length] !== 0 ? (100 * (v - src[i - length])) / src[i - length] : NaN));
}

export function trueRange(high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => (i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
}

export function atr(high: Series, low: Series, close: Series, length: number): Series {
  return rma(trueRange(high, low, close), length);
}

export function rsi(src: Series, length: number): Series {
  const up = change(src).map((d) => (isNum(d) ? Math.max(d, 0) : NaN));
  const down = change(src).map((d) => (isNum(d) ? Math.max(-d, 0) : NaN));
  const u = rma(up, length);
  const d = rma(down, length);
  return u.map((uv, i) => {
    const dv = d[i];
    if (!isNum(uv) || !isNum(dv)) return NaN;
    if (dv === 0) return 100;
    if (uv === 0) return 0;
    return 100 - 100 / (1 + uv / dv);
  });
}

export function macd(src: Series, fast: number, slow: number, signal: number): { macd: Series; signal: Series; histogram: Series } {
  const f = ema(src, fast);
  const s = ema(src, slow);
  const m = f.map((v, i) => v - s[i]);
  const sig = ema(m, signal);
  return { macd: m, signal: sig, histogram: m.map((v, i) => v - sig[i]) };
}

/** Stochastic %K (raw), as Pine's ta.stoch. */
export function stoch(close: Series, high: Series, low: Series, length: number): Series {
  const hh = highest(high, length);
  const ll = lowest(low, length);
  return close.map((c, i) => (isNum(hh[i]) && hh[i] !== ll[i] ? (100 * (c - ll[i])) / (hh[i] - ll[i]) : NaN));
}

export function cci(src: Series, length: number): Series {
  const m = sma(src, length);
  return src.map((v, i) => {
    if (!isNum(m[i])) return NaN;
    let dev = 0;
    for (let k = 0; k < length; k++) dev += Math.abs(src[i - k] - m[i]);
    dev /= length;
    return dev === 0 ? 0 : (v - m[i]) / (0.015 * dev);
  });
}

export function williamsR(close: Series, high: Series, low: Series, length: number): Series {
  const hh = highest(high, length);
  const ll = lowest(low, length);
  return close.map((c, i) => (isNum(hh[i]) && hh[i] !== ll[i] ? (-100 * (hh[i] - c)) / (hh[i] - ll[i]) : NaN));
}

export function obv(close: Series, volume: Series): Series {
  let acc = 0;
  return close.map((c, i) => {
    if (i > 0) acc += c > close[i - 1] ? volume[i] : c < close[i - 1] ? -volume[i] : 0;
    return acc;
  });
}

/** ADX with +DI / −DI (Wilder), as Pine's ta.dmi. */
export function dmi(high: Series, low: Series, close: Series, diLength: number, adxSmoothing: number): { plus: Series; minus: Series; adx: Series } {
  const plusDM = high.map((h, i) => {
    if (i === 0) return NaN;
    const up = h - high[i - 1];
    const down = low[i - 1] - low[i];
    return up > down && up > 0 ? up : 0;
  });
  const minusDM = high.map((h, i) => {
    if (i === 0) return NaN;
    const up = h - high[i - 1];
    const down = low[i - 1] - low[i];
    return down > up && down > 0 ? down : 0;
  });
  const tr = rma(trueRange(high, low, close), diLength);
  const plus = rma(plusDM, diLength).map((v, i) => (100 * v) / tr[i]);
  const minus = rma(minusDM, diLength).map((v, i) => (100 * v) / tr[i]);
  const dx = plus.map((p, i) => {
    const s = p + minus[i];
    return isNum(s) ? (s === 0 ? 0 : (100 * Math.abs(p - minus[i])) / s) : NaN;
  });
  return { plus, minus, adx: rma(dx, adxSmoothing) };
}

/** Supertrend, as Pine's ta.supertrend: direction −1 = uptrend (line below price), 1 = downtrend. */
export function supertrend(high: Series, low: Series, close: Series, factor: number, atrPeriod: number): { line: Series; direction: Series } {
  const a = atr(high, low, close, atrPeriod);
  const line = new Array<number>(close.length).fill(NaN);
  const direction = new Array<number>(close.length).fill(NaN);
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevST = NaN;
  for (let i = 0; i < close.length; i++) {
    if (!isNum(a[i])) continue;
    const hl2 = (high[i] + low[i]) / 2;
    let upper = hl2 + factor * a[i];
    let lower = hl2 - factor * a[i];
    const prevClose = close[i - 1];
    lower = isNum(prevLower) && !(lower > prevLower || prevClose < prevLower) ? prevLower : lower;
    upper = isNum(prevUpper) && !(upper < prevUpper || prevClose > prevUpper) ? prevUpper : upper;
    let dir: number;
    if (!isNum(prevST)) dir = 1;
    else if (prevST === prevUpper) dir = close[i] > upper ? -1 : 1;
    else dir = close[i] < lower ? 1 : -1;
    const st = dir === -1 ? lower : upper;
    line[i] = st;
    direction[i] = dir;
    prevUpper = upper;
    prevLower = lower;
    prevST = st;
  }
  return { line, direction };
}

/** Session VWAP: resets when `sessionKey` changes (e.g. the broker-clock trading day). */
export function vwap(hlc3: Series, volume: Series, sessionKey: number[]): Series {
  let pv = 0;
  let v = 0;
  return hlc3.map((p, i) => {
    if (i === 0 || sessionKey[i] !== sessionKey[i - 1]) {
      pv = 0;
      v = 0;
    }
    pv += p * volume[i];
    v += volume[i];
    return v > 0 ? pv / v : NaN;
  });
}

export function crossover(a: Series, b: Series): boolean[] {
  return a.map((v, i) => i > 0 && v > b[i] && a[i - 1] <= b[i - 1]);
}

export function crossunder(a: Series, b: Series): boolean[] {
  return a.map((v, i) => i > 0 && v < b[i] && a[i - 1] >= b[i - 1]);
}
