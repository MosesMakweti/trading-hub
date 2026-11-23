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

describe("catalogue and templates", () => {
  it("every templated script runs", async () => {
    const { SCRIPT_TEMPLATES } = await import("./builtins");
    for (const t of SCRIPT_TEMPLATES) expect(() => run(t.source, bars), t.key).not.toThrow();
    const strat = run(SCRIPT_TEMPLATES.find((t) => t.key === "strategy")!.source, bars);
    expect(strat.strategy!.totalTrades).toBeGreaterThan(0);
  });

  it("every catalogued function is accepted by the runtime (not 'Unknown function')", async () => {
    const { BUILTINS } = await import("./builtins");
    for (const b of BUILTINS.filter((x) => x.kind === "function" && !["indicator", "strategy"].includes(x.name))) {
      const call = `${b.name}(close, 1, 1, 1)`;
      try {
        run(`strategy("x")\nx = ${call}`, bars.slice(0, 30));
      } catch (e) {
        expect((e as Error).message, b.name).not.toMatch(/Unknown function|not supported/);
      }
    }
  });
});

describe("strategy point value", () => {
  it("scales P&L by syminfo.pointvalue (e.g. 100 000 per lot on EURUSD)", () => {
    const b = (i: number, o: number, c: number): ScriptBar => ({ time: i, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1 });
    const data = [b(0, 1.1, 1.1), b(1, 1.1, 1.1), b(2, 1.101, 1.101)];
    const src = `strategy("s")
if bar_index == 0
    strategy.entry("L", strategy.long, qty = 1)
if bar_index == 1
    strategy.close("L")
plot(syminfo.pointvalue)`;
    const r = run(src, [...data, b(3, 1.1015, 1.1015)], { pointValue: 100_000 });
    // Enter at bar 1 open (1.1), close at bar 2 open (1.101): 0.001 × 1 lot × 100 000 = 100.
    expect(r.strategy!.trades[0].pnl).toBeCloseTo(100, 6);
    expect(r.plots[0].values[0]).toBe(100_000);
  });
});

describe("streaming ta.* in scripts (exactly the batch results)", () => {
  it("every streamed function, conditional calls (skipped bars) and calls inside loops", () => {
    const src = `indicator("t", overlay = false)
plot(ta.wma(close, 9))
plot(ta.stdev(close, 20))
plot(ta.highest(high, 10) - ta.lowest(low, 10))
plot(ta.highest(close, 5))
plot(ta.change(close, 3))
plot(ta.roc(close, 4))
plot(ta.rsi(close, 14))
plot(ta.cci(close, 20))
plot(ta.tr())
plot(ta.atr(14))
plot(ta.stoch(close, high, low, 14))
[m, s, h] = ta.macd(close, 12, 26, 9)
plot(h)
[bb, bu, bl] = ta.bb(close, 20, 2)
plot(bu)
[dp, dm, adx] = ta.dmi(14, 14)
plot(adx)
[stl, std] = ta.supertrend(3, 10)
plot(stl)
plot(ta.vwap(hlc3))
plot(ta.obv())
plot(ta.vwma(close, 10))
x = 0.0
if bar_index % 3 != 0
    x := ta.rsi(close, 7)
plot(x)
y = 0.0
for i = 0 to 1
    y := ta.wma(close + i, 5)
plot(y)`;
    const r = run(src, bars);
    const H = bars.map((b) => b.high), L = bars.map((b) => b.low), C = closes, V = bars.map((b) => b.volume);
    const last = (s: number[]) => s;
    const p = (i: number) => r.plots[i].values;
    const eq = (a: number[], b: number[], label: string) => expect(a.map((v) => (Number.isFinite(v) ? v : NaN)), label).toEqual(b.map((v) => (Number.isFinite(v) ? v : NaN)));
    eq(p(0), ta.wma(C, 9), "wma");
    eq(p(1), ta.stdev(C, 20), "stdev");
    eq(p(2), ta.highest(H, 10).map((v, i) => v - ta.lowest(L, 10)[i]), "highest-lowest");
    eq(p(3), ta.highest(C, 5), "highest(close)");
    eq(p(4), ta.change(C, 3), "change");
    eq(p(5), ta.roc(C, 4), "roc");
    eq(p(6), ta.rsi(C, 14), "rsi");
    eq(p(7), ta.cci(C, 20), "cci");
    eq(p(8), ta.trueRange(H, L, C), "tr");
    eq(p(9), ta.atr(H, L, C, 14), "atr");
    eq(p(10), ta.stoch(C, H, L, 14), "stoch");
    eq(p(11), ta.macd(C, 12, 26, 9).histogram, "macd hist");
    eq(p(12), ta.sma(C, 20).map((b, i) => b + 2 * ta.stdev(C, 20)[i]), "bb upper");
    eq(p(13), ta.dmi(H, L, C, 14, 14).adx, "adx");
    eq(p(14), ta.supertrend(H, L, C, 3, 10).line, "supertrend");
    eq(p(15), ta.vwap(bars.map((b) => (b.high + b.low + b.close) / 3), V, bars.map((b) => Math.floor(b.time / 1440))), "vwap");
    eq(p(16), ta.obv(C, V), "obv");
    eq(p(17), ta.vwma(C, V, 10), "vwma");
    // Conditional call: skipped bars are NaN inputs (as before); plotted x is 0 on skipped bars.
    const masked = C.map((c, i) => (i % 3 !== 0 ? c : NaN));
    const rsi7 = ta.rsi(masked, 7);
    eq(p(18), C.map((_, i) => (i % 3 !== 0 ? rsi7[i] : 0)), "conditional rsi");
    // Called twice per bar inside a loop: the last call's input (close + 1) wins on every bar.
    eq(p(19), last(ta.wma(C.map((c) => c + 1), 5)), "loop wma");
  });

  it("is fast: all rolling functions on 5,000 bars well under the sandbox limit", () => {
    const many: ScriptBar[] = Array.from({ length: 5000 }, (_, i) => ({ ...bars[i % bars.length], time: 28_000_000 + i }));
    const t0 = performance.now();
    run(`indicator("x")
plot(ta.atr(14) + ta.rsi(close, 14) + ta.stdev(close, 20) + ta.wma(close, 20) + ta.cci(close, 20))
[a, b, c] = ta.dmi(14, 14)
plot(c)`, many);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
