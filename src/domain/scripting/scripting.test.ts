import { describe, expect, it } from "vitest";

import * as ta from "@/domain/indicators/ta";
import { ScriptSyntaxError } from "./lexer";
import { parse } from "./parser";
import { run, ScriptRuntimeError, type ScriptBar } from "./runtime";

const bars: ScriptBar[] = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 5 + (i % 7) * 0.1;
  return { time: 28_000_000 + i, open: c - 0.2, high: c + 0.5, low: c - 0.5, close: c, volume: 10 + (i % 5) };
});
const closes = bars.map((b) => b.close);
const near = (a: number[], b: number[]) =>
  a.forEach((v, i) => (Number.isFinite(b[i]) ? expect(v).toBeCloseTo(b[i], 9) : expect(Number.isFinite(v)).toBe(false)));

describe("parser", () => {
  it("parses blocks, else-if chains, functions and continuation lines", () => {
    const p = parse(`//@version=6
indicator("t")
f(x, n = 2) =>
    x * n
a = if close > open
    1
else if close < open
    -1
else
    0
b = f(close,
  3)
plot(a + b)`);
    expect(p.body.map((s) => s.k)).toEqual(["expr", "fn", "decl", "decl", "expr"]);
  });

  it("rejects unsupported features by name", () => {
    expect(() => parse(`x = request.security("A", "D", close)`)).toThrow(/request\.security is not supported/);
    expect(() => parse(`switch x\n    1 => 2`)).toThrow(/switch is not supported/);
    expect(() => parse(`import a/b/1`)).toThrow(ScriptSyntaxError);
  });

  it("reports a syntax error with its line", () => {
    try {
      parse(`indicator("x")\nplot(close +)`);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptSyntaxError);
      expect((e as ScriptSyntaxError).line).toBe(2);
    }
  });
});

describe("runtime: indicators", () => {
  it("ta.sma/ema/rsi match the tested batch functions", () => {
    const r = run(`indicator("x")
plot(ta.sma(close, 14))
plot(ta.ema(close, 10))
plot(ta.rsi(close, 14))
plot(ta.atr(14))`, bars);
    near(r.plots[0].values, ta.sma(closes, 14));
    near(r.plots[1].values, ta.ema(closes, 10));
    near(r.plots[2].values, ta.rsi(closes, 14));
    near(r.plots[3].values, ta.atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14));
  });

  it("each call site keeps its own state", () => {
    const r = run(`indicator("x")
a = ta.sma(close, 5)
b = ta.sma(open, 5)
plot(a)
plot(b)`, bars);
    near(r.plots[0].values, ta.sma(closes, 5));
    near(r.plots[1].values, ta.sma(bars.map((b) => b.open), 5));
  });

  it("var persists; plain declarations re-run; history works", () => {
    const r = run(`indicator("x")
var count = 0
count := count + 1
x = close
plot(count)
plot(x[1])
plot(ta.sma(close, 3)[2])`, bars.slice(0, 6));
    expect(r.plots[0].values).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.plots[1].values[0]).toBeNaN();
    expect(r.plots[1].values[3]).toBe(closes[2]);
    const sma3 = ta.sma(closes.slice(0, 6), 3);
    expect(r.plots[2].values[5]).toBeCloseTo(sma3[3], 10);
  });

  it("user functions keep per-call-site ta state", () => {
    const r = run(`indicator("x")
smooth(src) => ta.ema(src, 4)
plot(smooth(close))
plot(smooth(open))`, bars);
    near(r.plots[0].values, ta.ema(closes, 4));
    near(r.plots[1].values, ta.ema(bars.map((b) => b.open), 4));
  });

  it("inputs: descriptors, overrides and clamping", () => {
    const src = `indicator("x")
len = input.int(14, "Length", minval = 2, maxval = 50)
plot(ta.sma(close, len))`;
    const def = run(src, bars);
    expect(def.inputs).toEqual([{ key: "Length", type: "int", default: 14, min: 2, max: 50 }]);
    const over = run(src, bars, { inputs: { Length: 999 } });
    near(over.plots[0].values, ta.sma(closes, 50));
  });

  it("never looks ahead: values at bar i don't change when bars are appended", () => {
    const src = `indicator("x")
plot(ta.rsi(close, 14) + ta.highest(high, 10) - nz(close[3]))
plotshape(ta.crossover(ta.ema(close, 5), ta.ema(close, 20)))`;
    const a = run(src, bars.slice(0, 200));
    const b = run(src, bars);
    expect(b.plots[0].values.slice(0, 200)).toEqual(a.plots[0].values);
    expect(b.shapes.filter((s) => s.bar < 200)).toEqual(a.shapes);
  });

  it("enforces the instruction budget and loop cap", () => {
    expect(() => run(`indicator("x")\nfor i = 0 to 1000000\n    x = i`, bars.slice(0, 1))).toThrow(/loop exceeded/);
    expect(() => run(`indicator("x")\nplot(close)`, bars, { maxSteps: 50 })).toThrow(ScriptRuntimeError);
  });

  it("requires a declaration and rejects unknown functions", () => {
    expect(() => run(`plot(close)`, bars.slice(0, 2))).toThrow(/indicator/);
    expect(() => run(`indicator("x")\nplot(foo(close))`, bars.slice(0, 2))).toThrow(/Unknown function "foo"/);
  });
});

describe("runtime: strategy tester", () => {
  const b = (i: number, o: number, h: number, l: number, c: number): ScriptBar => ({ time: i, open: o, high: h, low: l, close: c, volume: 1 });

  it("market entries fill at the next bar's open; exits by stop/limit", () => {
    const data = [b(0, 10, 10, 10, 10), b(1, 11, 12, 10, 11), b(2, 11, 15, 11, 14), b(3, 14, 14, 13, 13)];
    const r = run(`strategy("s", initial_capital = 1000)
if bar_index == 0
    strategy.entry("L", strategy.long, qty = 2)
strategy.exit("X", "L", limit = 14, stop = 9)`, data);
    const s = r.strategy!;
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0]).toMatchObject({ entryBar: 1, entryPrice: 11, exitBar: 2, exitPrice: 14, pnl: 6 });
    expect(s.netProfit).toBe(6);
  });

  it("a bar touching both stop and limit fills the stop (conservative)", () => {
    const data = [b(0, 10, 10, 10, 10), b(1, 10, 10, 10, 10), b(2, 10, 20, 0, 10)];
    const r = run(`strategy("s")
if bar_index == 0
    strategy.entry("L", strategy.long, qty = 1)
strategy.exit("X", "L", limit = 15, stop = 5)`, data);
    expect(r.strategy!.trades[0]).toMatchObject({ exitPrice: 5, exitReason: "Stop X" });
  });

  it("orders placed on a forming last bar never fill", () => {
    const data = [b(0, 10, 10, 10, 10), b(1, 10, 10, 10, 10)];
    const src = `strategy("s")
if barstate.islast
    strategy.entry("L", strategy.long, qty = 1)`;
    expect(run(src, data, { lastBarForming: true }).strategy!.openPosition).toBeNull();
  });

  it("reversal closes the open trade; report stats are consistent", () => {
    const r = run(`strategy("s", initial_capital = 10000)
fast = ta.sma(close, 5)
slow = ta.sma(close, 20)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long, qty = 1)
if ta.crossunder(fast, slow)
    strategy.entry("S", strategy.short, qty = 1)`, bars);
    const s = r.strategy!;
    expect(s.totalTrades).toBeGreaterThan(2);
    expect(s.winningTrades + s.losingTrades).toBeLessThanOrEqual(s.totalTrades);
    expect(s.netProfit).toBeCloseTo(s.trades.reduce((x, t) => x + t.pnl, 0), 9);
    expect(s.equity).toHaveLength(bars.length);
    for (let i = 1; i < s.trades.length; i++) expect(s.trades[i].entryBar).toBeGreaterThanOrEqual(s.trades[i - 1].exitBar);
  });
});
