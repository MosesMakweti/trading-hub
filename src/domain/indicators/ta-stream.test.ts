import { describe, expect, it } from "vitest";

import * as ta from "./ta";
import * as st from "./ta-stream";

/** Deterministic random walk with optional NaN gaps. */
function series(n: number, seed: number, gaps = false) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let p = 1.08;
  const close: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const vol: number[] = [];
  const key: number[] = [];
  for (let i = 0; i < n; i++) {
    p += (rnd() - 0.5) * 0.002;
    const c = gaps && rnd() < 0.03 ? NaN : p;
    close.push(c);
    high.push(p + rnd() * 0.001);
    low.push(p - rnd() * 0.001);
    vol.push(Math.floor(rnd() * 100));
    key.push(Math.floor(i / 97));
  }
  return { close, high, low, vol, key };
}

const run = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("streaming ta equals batch ta exactly", () => {
  for (const [label, gaps] of [["clean", false], ["with NaN gaps", true]] as const) {
    it(`single-input functions (${label})`, () => {
      for (const seed of [1, 7, 42]) {
        const { close } = series(700, seed, gaps);
        const n = close.length;
        for (const len of [1, 2, 3, 9, 14, 50]) {
          const sma = new st.SmaStream(len), ema = st.emaStream(len), rma = st.rmaStream(len), wma = new st.WmaStream(len);
          const hi = new st.ExtremeStream(len, "highest"), lo = new st.ExtremeStream(len, "lowest"), sd = new st.StdevStream(len), cci = new st.CciStream(len);
          const rsi = new st.RsiStream(len), lag = new st.LagStream(len);
          expect(run(n, (i) => sma.next(close[i])), `sma ${len}`).toEqual(ta.sma(close, len));
          expect(run(n, (i) => ema.next(close[i])), `ema ${len}`).toEqual(ta.ema(close, len));
          expect(run(n, (i) => rma.next(close[i])), `rma ${len}`).toEqual(ta.rma(close, len));
          expect(run(n, (i) => wma.next(close[i])), `wma ${len}`).toEqual(ta.wma(close, len));
          expect(run(n, (i) => hi.next(close[i])), `highest ${len}`).toEqual(ta.highest(close, len));
          expect(run(n, (i) => lo.next(close[i])), `lowest ${len}`).toEqual(ta.lowest(close, len));
          expect(run(n, (i) => sd.next(close[i])), `stdev ${len}`).toEqual(ta.stdev(close, len));
          expect(run(n, (i) => cci.next(close[i])), `cci ${len}`).toEqual(ta.cci(close, len));
          expect(run(n, (i) => rsi.next(close[i])), `rsi ${len}`).toEqual(ta.rsi(close, len));
          expect(run(n, (i) => close[i] - lag.next(close[i])), `change ${len}`).toEqual(ta.change(close, len));
        }
      }
    });
  }

  it("multi-input functions", () => {
    for (const seed of [3, 11]) {
      const { close, high, low, vol, key } = series(800, seed);
      const n = close.length;
      for (const len of [2, 5, 14, 30]) {
        const atr = new st.AtrStream(len), stoch = new st.StochStream(len), dmi = new st.DmiStream(len, len + 1), vw = new st.VwmaStream(len);
        expect(run(n, (i) => atr.next(high[i], low[i], close[i])), `atr ${len}`).toEqual(ta.atr(high, low, close, len));
        expect(run(n, (i) => stoch.next(close[i], high[i], low[i])), `stoch ${len}`).toEqual(ta.stoch(close, high, low, len));
        const d = ta.dmi(high, low, close, len, len + 1);
        const ds = run(n, (i) => dmi.next(high[i], low[i], close[i]));
        expect(ds.map((x) => x[0]), `dmi+ ${len}`).toEqual(d.plus);
        expect(ds.map((x) => x[1]), `dmi- ${len}`).toEqual(d.minus);
        expect(ds.map((x) => x[2]), `adx ${len}`).toEqual(d.adx);
        expect(run(n, (i) => vw.next(close[i], vol[i])), `vwma ${len}`).toEqual(ta.vwma(close, vol, len));
      }
      const m = ta.macd(close, 12, 26, 9);
      const ms = new st.MacdStream(12, 26, 9);
      const mo = run(n, (i) => ms.next(close[i]));
      expect(mo.map((x) => x[0])).toEqual(m.macd);
      expect(mo.map((x) => x[1])).toEqual(m.signal);
      expect(mo.map((x) => x[2])).toEqual(m.histogram);
      for (const [f, p] of [[3, 10], [2, 7]] as const) {
        const s = ta.supertrend(high, low, close, f, p);
        const ss = new st.SupertrendStream(f, p);
        const so = run(n, (i) => ss.next(high[i], low[i], close[i]));
        expect(so.map((x) => x[0])).toEqual(s.line);
        expect(so.map((x) => x[1])).toEqual(s.direction);
      }
      const vwap = new st.VwapStream(), obv = new st.ObvStream(), tr = new st.TrueRangeStream();
      expect(run(n, (i) => vwap.next(close[i], vol[i], key[i]))).toEqual(ta.vwap(close, vol, key));
      expect(run(n, (i) => obv.next(close[i], vol[i]))).toEqual(ta.obv(close, vol));
      expect(run(n, (i) => tr.next(high[i], low[i], close[i]))).toEqual(ta.trueRange(high, low, close));
    }
  });
});
