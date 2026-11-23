/**
 * Streaming (bar-by-bar) versions of the ta.ts primitives, for the script
 * runtime: each `next(...)` takes one bar's inputs and returns that bar's
 * value in O(1) or O(length) — instead of recomputing the whole history on
 * every bar (O(n²) over a run).
 *
 * Exactness: each stream performs the SAME floating-point operations in the
 * SAME order as its batch counterpart in ta.ts (running sums, SMA seeding,
 * window loops), so results are bit-identical — verified by property tests
 * against ta.ts on random series with gaps (ta-stream.test.ts).
 */

const isNum = (v: number) => Number.isFinite(v);

/** Last `n` values, oldest first, with O(1) push. */
class Ring {
  private buf: number[];
  private start = 0;
  size = 0;
  constructor(private readonly n: number) {
    this.buf = new Array<number>(n);
  }
  push(v: number): number | undefined {
    let evicted: number | undefined;
    if (this.size < this.n) {
      this.buf[(this.start + this.size) % this.n] = v;
      this.size++;
    } else {
      evicted = this.buf[this.start];
      this.buf[this.start] = v;
      this.start = (this.start + 1) % this.n;
    }
    return evicted;
  }
  /** k bars ago (0 = latest). */
  ago(k: number): number {
    return this.buf[(this.start + this.size - 1 - k) % this.n];
  }
}

export class SmaStream {
  private sum = 0;
  private valid = 0;
  private i = -1;
  private win: Ring;
  constructor(private readonly length: number) {
    this.win = new Ring(length + 1);
  }
  next(v: number): number {
    this.i++;
    this.win.push(v);
    if (isNum(v)) {
      this.sum += v;
      this.valid++;
    }
    if (this.i >= this.length) {
      const old = this.win.ago(this.length);
      if (isNum(old)) {
        this.sum -= old;
        this.valid--;
      }
    }
    return this.i >= this.length - 1 && this.valid === this.length ? this.sum / this.length : NaN;
  }
}

/** EMA / RMA: SMA-seeded exponential smoothing (ta.ts `smoothed`). */
export class SmoothedStream {
  private seed: SmaStream;
  private prev = NaN;
  constructor(
    length: number,
    private readonly alpha: number,
  ) {
    this.seed = new SmaStream(length);
  }
  next(v: number): number {
    const s = this.seed.next(v);
    if (!isNum(this.prev)) {
      if (isNum(s)) this.prev = s;
    } else if (isNum(v)) {
      this.prev = this.alpha * v + (1 - this.alpha) * this.prev;
    }
    return this.prev;
  }
}
export const emaStream = (length: number) => new SmoothedStream(length, 2 / (length + 1));
export const rmaStream = (length: number) => new SmoothedStream(length, 1 / length);

/** Window-loop functions (wma, highest, lowest, stdev, cci) over the last `length` values. */
export class WindowStream {
  private win: Ring;
  private i = -1;
  constructor(private readonly length: number) {
    this.win = new Ring(length);
  }
  push(v: number): void {
    this.i++;
    this.win.push(v);
  }
  get full(): boolean {
    return this.i >= this.length - 1;
  }
  ago(k: number): number {
    return this.win.ago(k);
  }
}

export class WmaStream {
  private w: WindowStream;
  private readonly denom: number;
  constructor(private readonly length: number) {
    this.w = new WindowStream(length);
    this.denom = (length * (length + 1)) / 2;
  }
  next(v: number): number {
    this.w.push(v);
    if (!this.w.full) return NaN;
    let s = 0;
    for (let k = 0; k < this.length; k++) {
      const x = this.w.ago(k);
      if (!isNum(x)) return NaN;
      s += x * (this.length - k);
    }
    return s / this.denom;
  }
}

export class ExtremeStream {
  private w: WindowStream;
  constructor(
    private readonly length: number,
    private readonly kind: "highest" | "lowest",
  ) {
    this.w = new WindowStream(length);
  }
  next(v: number): number {
    this.w.push(v);
    if (!this.w.full) return NaN;
    let m = this.kind === "highest" ? -Infinity : Infinity;
    for (let k = 0; k < this.length; k++) m = this.kind === "highest" ? Math.max(m, this.w.ago(k)) : Math.min(m, this.w.ago(k));
    return isNum(m) ? m : NaN;
  }
}

export class StdevStream {
  private mean: SmaStream;
  private w: WindowStream;
  constructor(private readonly length: number) {
    this.mean = new SmaStream(length);
    this.w = new WindowStream(length);
  }
  next(v: number): number {
    const m = this.mean.next(v);
    this.w.push(v);
    if (!isNum(m)) return NaN;
    let s = 0;
    for (let k = 0; k < this.length; k++) s += (this.w.ago(k) - m) ** 2;
    return Math.sqrt(s / this.length);
  }
}

export class CciStream {
  private mean: SmaStream;
  private w: WindowStream;
  constructor(private readonly length: number) {
    this.mean = new SmaStream(length);
    this.w = new WindowStream(length);
  }
  next(v: number): number {
    const m = this.mean.next(v);
    this.w.push(v);
    if (!isNum(m)) return NaN;
    let dev = 0;
    for (let k = 0; k < this.length; k++) dev += Math.abs(this.w.ago(k) - m);
    dev /= this.length;
    return dev === 0 ? 0 : (v - m) / (0.015 * dev);
  }
}

/** change / mom / roc: needs the value `length` bars ago. */
export class LagStream {
  private w: Ring;
  private i = -1;
  constructor(private readonly length: number) {
    this.w = new Ring(length + 1);
  }
  next(v: number): number {
    this.i++;
    this.w.push(v);
    return this.i >= this.length ? this.w.ago(this.length) : NaN;
  }
}

export class TrueRangeStream {
  private prevClose = NaN;
  private i = -1;
  next(h: number, l: number, c: number): number {
    this.i++;
    const tr = this.i === 0 ? h - l : Math.max(h - l, Math.abs(h - this.prevClose), Math.abs(l - this.prevClose));
    this.prevClose = c;
    return tr;
  }
}

export class AtrStream {
  private tr = new TrueRangeStream();
  private r: SmoothedStream;
  constructor(length: number) {
    this.r = rmaStream(length);
  }
  next(h: number, l: number, c: number): number {
    return this.r.next(this.tr.next(h, l, c));
  }
}

export class RsiStream {
  private lag = new LagStream(1);
  private u: SmoothedStream;
  private d: SmoothedStream;
  constructor(length: number) {
    this.u = rmaStream(length);
    this.d = rmaStream(length);
  }
  next(v: number): number {
    const prev = this.lag.next(v);
    const ch = v - prev; // NaN on the first bar, as ta.change
    const uv = this.u.next(isNum(ch) ? Math.max(ch, 0) : NaN);
    const dv = this.d.next(isNum(ch) ? Math.max(-ch, 0) : NaN);
    if (!isNum(uv) || !isNum(dv)) return NaN;
    if (dv === 0) return 100;
    if (uv === 0) return 0;
    return 100 - 100 / (1 + uv / dv);
  }
}

export class MacdStream {
  private f: SmoothedStream;
  private s: SmoothedStream;
  private sig: SmoothedStream;
  constructor(fast: number, slow: number, signal: number) {
    this.f = emaStream(fast);
    this.s = emaStream(slow);
    this.sig = emaStream(signal);
  }
  next(v: number): [number, number, number] {
    const m = this.f.next(v) - this.s.next(v);
    const sg = this.sig.next(m);
    return [m, sg, m - sg];
  }
}

export class StochStream {
  private hh: ExtremeStream;
  private ll: ExtremeStream;
  constructor(length: number) {
    this.hh = new ExtremeStream(length, "highest");
    this.ll = new ExtremeStream(length, "lowest");
  }
  next(c: number, h: number, l: number): number {
    const hh = this.hh.next(h);
    const ll = this.ll.next(l);
    return isNum(hh) && hh !== ll ? (100 * (c - ll)) / (hh - ll) : NaN;
  }
}

export class DmiStream {
  private i = -1;
  private prevHigh = NaN;
  private prevLow = NaN;
  private tr = new TrueRangeStream();
  private trR: SmoothedStream;
  private plusR: SmoothedStream;
  private minusR: SmoothedStream;
  private adxR: SmoothedStream;
  constructor(diLength: number, adxSmoothing: number) {
    this.trR = rmaStream(diLength);
    this.plusR = rmaStream(diLength);
    this.minusR = rmaStream(diLength);
    this.adxR = rmaStream(adxSmoothing);
  }
  next(h: number, l: number, c: number): [number, number, number] {
    this.i++;
    let plusDM = NaN;
    let minusDM = NaN;
    if (this.i > 0) {
      const up = h - this.prevHigh;
      const down = this.prevLow - l;
      plusDM = up > down && up > 0 ? up : 0;
      minusDM = down > up && down > 0 ? down : 0;
    }
    this.prevHigh = h;
    this.prevLow = l;
    const tr = this.trR.next(this.tr.next(h, l, c));
    const plus = (100 * this.plusR.next(plusDM)) / tr;
    const minus = (100 * this.minusR.next(minusDM)) / tr;
    const s = plus + minus;
    const dx = isNum(s) ? (s === 0 ? 0 : (100 * Math.abs(plus - minus)) / s) : NaN;
    return [plus, minus, this.adxR.next(dx)];
  }
}

export class SupertrendStream {
  private atr: AtrStream;
  private prevUpper = NaN;
  private prevLower = NaN;
  private prevST = NaN;
  private prevClose: number | undefined = undefined;
  constructor(
    private readonly factor: number,
    atrPeriod: number,
  ) {
    this.atr = new AtrStream(atrPeriod);
  }
  next(h: number, l: number, c: number): [number, number] {
    const a = this.atr.next(h, l, c);
    const prevClose = this.prevClose as number; // undefined on bar 0 — as close[i - 1] in ta.ts
    this.prevClose = c;
    if (!isNum(a)) return [NaN, NaN];
    const hl2 = (h + l) / 2;
    let upper = hl2 + this.factor * a;
    let lower = hl2 - this.factor * a;
    lower = isNum(this.prevLower) && !(lower > this.prevLower || prevClose < this.prevLower) ? this.prevLower : lower;
    upper = isNum(this.prevUpper) && !(upper < this.prevUpper || prevClose > this.prevUpper) ? this.prevUpper : upper;
    let dir: number;
    if (!isNum(this.prevST)) dir = 1;
    else if (this.prevST === this.prevUpper) dir = c > upper ? -1 : 1;
    else dir = c < lower ? 1 : -1;
    const st = dir === -1 ? lower : upper;
    this.prevUpper = upper;
    this.prevLower = lower;
    this.prevST = st;
    return [st, dir];
  }
}

export class VwapStream {
  private pv = 0;
  private v = 0;
  private key: number | undefined = undefined;
  next(price: number, volume: number, sessionKey: number): number {
    if (this.key === undefined || sessionKey !== this.key) {
      this.pv = 0;
      this.v = 0;
    }
    this.key = sessionKey;
    this.pv += price * volume;
    this.v += volume;
    return this.v > 0 ? this.pv / this.v : NaN;
  }
}

export class ObvStream {
  private acc = 0;
  private prev: number | undefined = undefined;
  next(c: number, volume: number): number {
    if (this.prev !== undefined) this.acc += c > this.prev ? volume : c < this.prev ? -volume : 0;
    this.prev = c;
    return this.acc;
  }
}

export class VwmaStream {
  private a: SmaStream;
  private b: SmaStream;
  constructor(length: number) {
    this.a = new SmaStream(length);
    this.b = new SmaStream(length);
  }
  next(v: number, volume: number): number {
    const x = this.a.next(v * volume);
    const y = this.b.next(volume);
    return y ? x / y : NaN;
  }
}
