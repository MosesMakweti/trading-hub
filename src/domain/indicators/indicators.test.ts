import { describe, expect, it } from "vitest";

import * as ta from "./ta";
import { INDICATORS, INDICATOR_BY_ID, defaultInputs, sanitizeInputs, type IndicatorBar } from "./catalog";
import { heikinAshi, lineBreak, rangeBars, renko, transform, type OhlcCandle } from "./chart-types";

const round = (s: number[], d = 6) => s.map((v) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null));

describe("ta primitives (hand-calculated)", () => {
  it("SMA / EMA (SMA-seeded) / WMA", () => {
    const s = [1, 2, 3, 4, 5];
    expect(round(ta.sma(s, 3))).toEqual([null, null, 2, 3, 4]);
    // alpha = 0.5; seed SMA(1,2,3)=2 → 0.5·4+0.5·2 = 3 → 4
    expect(round(ta.ema(s, 3))).toEqual([null, null, 2, 3, 4]);
    // (3·3 + 2·2 + 1·1)/6 = 14/6
    expect(round(ta.wma(s, 3), 4)).toEqual([null, null, 2.3333, 3.3333, 4.3333]);
  });

  it("RMA and RSI on an alternating series: 75 at the 4th bar", () => {
    // changes +1,−1,+1,−1,+1 → gains seed 0.5, losses 0.5; next: gain 0.75, loss 0.25 → RSI 75
    expect(round(ta.rsi([1, 2, 1, 2, 1, 2], 2), 4)).toEqual([null, null, 50, 75, 37.5, 68.75]);
  });

  it("true range and ATR use the previous close", () => {
    const h = [10, 12, 11];
    const l = [9, 10, 8];
    const c = [9.5, 11, 9];
    expect(ta.trueRange(h, l, c)).toEqual([1, 2.5, 3]);
    expect(round(ta.atr(h, l, c, 2))).toEqual([null, 1.75, 2.375]);
  });

  it("population stdev, highest / lowest, change, ROC", () => {
    expect(round(ta.stdev([2, 4, 4, 4, 5, 5, 7, 9], 8))).toEqual([null, null, null, null, null, null, null, 2]);
    expect(ta.highest([1, 3, 2, 5], 2)).toEqual([NaN, 3, 3, 5]);
    expect(ta.lowest([1, 3, 2, 5], 2)).toEqual([NaN, 1, 2, 2]);
    expect(round(ta.roc([100, 110, 99], 1))).toEqual([null, 10, -10]);
  });

  it("MACD = fast EMA − slow EMA; histogram = MACD − signal", () => {
    const s = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const m = ta.macd(s, 3, 6, 3);
    const i = 30;
    expect(m.macd[i]).toBeCloseTo(ta.ema(s, 3)[i] - ta.ema(s, 6)[i], 10);
    expect(m.histogram[i]).toBeCloseTo(m.macd[i] - m.signal[i], 10);
  });

  it("stochastic, Williams %R, OBV, crossovers", () => {
    expect(ta.stoch([5], [10], [0], 1)).toEqual([50]);
    expect(ta.williamsR([5], [10], [0], 1)).toEqual([-50]);
    expect(ta.obv([1, 2, 1, 1], [10, 20, 30, 40])).toEqual([0, 20, -10, -10]);
    expect(ta.crossover([1, 3], [2, 2])).toEqual([false, true]);
    expect(ta.crossunder([3, 1], [2, 2])).toEqual([false, true]);
  });

  it("never looks ahead: a value at i is unchanged when later bars are appended", () => {
    const base = Array.from({ length: 60 }, (_, i) => 100 + ((i * 7) % 13));
    const more = [...base, 999, 1, 500];
    for (const f of [(s: number[]) => ta.ema(s, 10), (s: number[]) => ta.rsi(s, 14), (s: number[]) => ta.stdev(s, 20)]) {
      expect(f(more).slice(0, base.length)).toEqual(f(base));
    }
  });
});

describe("indicator catalog", () => {
  const bars: IndicatorBar[] = Array.from({ length: 3000 }, (_, i) => {
    const c = 1.08 + Math.sin(i / 50) * 0.01 + (i % 7) * 0.0001;
    return { time: 28_000_000 + i, open: c - 0.0002, high: c + 0.0005, low: c - 0.0005, close: c, volume: 10 + (i % 5) };
  });

  it("every indicator computes every declared plot with the input length", () => {
    for (const def of INDICATORS) {
      const out = def.compute(bars, defaultInputs(def));
      for (const p of def.plots) {
        expect(out[p.key], `${def.id}.${p.key}`).toHaveLength(bars.length);
        expect(out[p.key].some(Number.isFinite), `${def.id}.${p.key} has values`).toBe(true);
      }
    }
  });

  it("Bollinger: basis ± 2σ; pivots use the previous broker day", () => {
    const bb = INDICATOR_BY_ID.get("bb")!.compute(bars, defaultInputs(INDICATOR_BY_ID.get("bb")!));
    const sd = ta.stdev(bars.map((b) => b.close), 20)[100];
    expect(bb.upper[100] - bb.basis[100]).toBeCloseTo(2 * sd, 10);
    const two: IndicatorBar[] = [
      { time: 0, open: 1, high: 3, low: 1, close: 2, volume: 1 },
      { time: 1440, open: 2, high: 2, low: 2, close: 2, volume: 1 },
    ];
    const pv = INDICATOR_BY_ID.get("pivots")!.compute(two, {});
    expect(pv.P[0]).toBeNaN();
    expect(pv.P[1]).toBe(2); // (3 + 1 + 2) / 3
    expect(pv.R1[1]).toBe(3); // 2·2 − 1
    expect(pv.S1[1]).toBe(1); // 2·2 − 3
  });

  it("clamps and sanitises user inputs", () => {
    const rsi = INDICATOR_BY_ID.get("rsi")!;
    expect(sanitizeInputs(rsi, { length: "9999", source: "evil()", extra: 1 })).toEqual({ length: 500, source: "close" });
    expect(sanitizeInputs(rsi, { length: 7.6 })).toEqual({ length: 8, source: "close" });
  });
});

describe("chart-type transforms", () => {
  const c = (time: number, open: number, high: number, low: number, close: number): OhlcCandle => ({ time, open, high, low, close });

  it("Heikin Ashi: close = OHLC/4, open = midpoint of the previous HA body", () => {
    const ha = heikinAshi([c(0, 1, 3, 0, 2), c(1, 2, 4, 1, 3)]);
    expect([ha[0].open, ha[0].close]).toEqual([1.5, 1.5]);
    expect([ha[1].open, ha[1].close]).toEqual([1.5, 2.5]);
    expect(ha.every((x) => x.synthetic)).toBe(true);
  });

  it("Renko (box 1): two up bricks, then a reversal needs two boxes", () => {
    const r = renko([c(0, 0, 0, 0, 0), c(1, 0, 0, 0, 1.2), c(2, 0, 0, 0, 2.1), c(3, 0, 0, 0, 0.5), c(4, 0, 0, 0, -0.2)], 1);
    expect(r.map((b) => [b.open, b.close, b.sourceMinute])).toEqual([[0, 1, 1], [1, 2, 2], [1, 0, 4]]);
  });

  it("3-line break reverses only beyond the last three lines", () => {
    const lb = lineBreak([c(0, 10, 10, 10, 11), c(1, 0, 0, 0, 12), c(2, 0, 0, 0, 13), c(3, 0, 0, 0, 11.5), c(4, 0, 0, 0, 10.5)], 3);
    // 11.5 is inside the last three lines' range (10–13): no line; 10.5 is not below 10 either.
    expect(lb.map((l) => [l.open, l.close])).toEqual([[10, 11], [11, 12], [12, 13]]);
  });

  it("range bars split a candle into fixed-range bars, the last one forming", () => {
    const rb = rangeBars([c(5, 0, 3, 0, 3)], 1);
    expect(rb.map((b) => [b.open, b.close, !!b.forming])).toEqual([[0, 1, false], [1, 2, false], [2, 3, true]]);
    expect(new Set(rb.map((b) => b.time)).size).toBe(3); // strictly increasing synthetic seconds
  });

  it("transform keeps plain candles plain and in seconds", () => {
    const out = transform("candles", [c(10, 1, 2, 0, 1)], null, 5);
    expect(out[0]).toMatchObject({ time: 600, synthetic: false, sourceMinute: 10 });
  });
});
