/**
 * Traditorium Script interpreter — Pine Script®-style semantics for the
 * documented subset (README.md). Pure: no I/O, no eval, no access to anything
 * but the bars it is given. Runs in a Web Worker in the browser.
 *
 * Execution model (as Pine): the script body runs once per bar, oldest first.
 *  - Global variables keep a per-bar history (`x[n]`); `var` keeps its value
 *    across bars; other declarations re-run every bar.
 *  - History on any other expression (`ta.sma(close, 14)[1]`) records that
 *    expression's value per bar at its call site.
 *  - Stateful built-ins (ta.*) keep state per CALL SITE (including the chain
 *    of user-function calls leading to it), so two calls never share state.
 *  - A value at bar i depends only on bars ≤ i. The last bar may be forming
 *    (replay): it is evaluated but `barstate.isconfirmed` is false, and
 *    strategy orders placed on it are not filled (there is no next bar).
 *
 * Limits: an instruction budget per run, an iteration cap per loop, caps on
 * plots, shapes, logs and string lengths. Exceeding one stops the run with
 * a clear error.
 */
import * as ta from "@/domain/indicators/ta";
import { ScriptSyntaxError } from "./lexer";
import { parse, type Expr, type Program, type Stmt } from "./parser";

export type Value = number | boolean | string | null | Value[];

export interface ScriptBar {
  time: number; // broker wall-clock minute
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InputDescriptor {
  key: string;
  type: "int" | "float" | "bool" | "string" | "source" | "color";
  default: Value;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface PlotOut {
  id: string;
  title: string;
  color: string;
  linewidth: number;
  style: "line" | "histogram" | "circles" | "area" | "columns" | "stepline" | "cross";
  values: number[];
  colors: (string | null)[];
}

export interface ShapeOut {
  bar: number;
  title: string;
  location: "abovebar" | "belowbar" | "absolute" | "top" | "bottom";
  style: string;
  color: string;
  text: string;
  price: number | null;
}

export interface TradeOut {
  side: "long" | "short";
  entryId: string;
  qty: number;
  entryBar: number;
  entryPrice: number;
  exitBar: number;
  exitPrice: number;
  pnl: number;
  exitReason: string;
}

export interface StrategyReport {
  initialCapital: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  maxDrawdown: number;
  commissionPaid: number;
  openPosition: { side: "long" | "short"; qty: number; avgPrice: number; openPnl: number } | null;
  trades: TradeOut[];
  equity: number[];
}

export interface RunResult {
  kind: "indicator" | "strategy";
  title: string;
  overlay: boolean;
  inputs: InputDescriptor[];
  plots: PlotOut[];
  hlines: { price: number; title: string; color: string }[];
  bgcolor: (string | null)[];
  barcolor: (string | null)[];
  shapes: ShapeOut[];
  alerts: { bar: number; title: string; message: string }[];
  logs: { bar: number; level: "info" | "warning" | "error"; message: string }[];
  strategy: StrategyReport | null;
  steps: number;
}

export class ScriptRuntimeError extends Error {
  constructor(
    message: string,
    public line: number | null,
  ) {
    super(message);
    this.name = "ScriptRuntimeError";
  }
}

export const LIMITS = { steps: 20_000_000, loopIterations: 100_000, plots: 64, shapes: 5_000, logs: 1_000, string: 4_096, bars: 50_000 } as const;

const COLORS: Record<string, string> = {
  red: "#f23645", green: "#089981", blue: "#2962ff", orange: "#ff9800", yellow: "#fdd835", purple: "#9c27b0", teal: "#00897b",
  aqua: "#00bcd4", lime: "#00e676", fuchsia: "#e040fb", maroon: "#880e4f", navy: "#311b92", olive: "#808000", silver: "#b2b5be",
  gray: "#787b86", white: "#ffffff", black: "#363a45",
};

class Break {}
class Continue {}

interface Callsite {
  hist: Value[];
  state: Record<string, unknown>;
}

interface Fn {
  params: { name: string; def: Expr | null }[];
  body: Stmt[];
}

export interface RunOptions {
  inputs?: Record<string, Value>;
  /** The last bar is still forming (replay): not confirmed, its orders never fill. */
  lastBarForming?: boolean;
  /** Price precision for rounding strategy fills (optional). */
  maxSteps?: number;
}

export function compile(source: string): Program {
  return parse(source);
}

/** Runs a script over the bars. Throws ScriptSyntaxError / ScriptRuntimeError. */
export function run(source: string | Program, bars: ScriptBar[], options: RunOptions = {}): RunResult {
  const program = typeof source === "string" ? parse(source) : source;
  if (bars.length > LIMITS.bars) throw new ScriptRuntimeError(`At most ${LIMITS.bars} bars per run.`, null);
  return new Interpreter(program, bars, options).run();
}

class Interpreter {
  private steps = 0;
  private readonly maxSteps: number;
  private bar = 0;
  private globals = new Map<string, { cur: Value; hist: Value[]; persist: boolean; initialized: boolean }>();
  private scopes: Map<string, Value>[] = [];
  private fns = new Map<string, Fn>();
  private sites = new Map<string, Callsite>();
  private stack: number[] = [];
  private declaredThisBar = new Set<string>();

  private result: RunResult = { kind: "indicator", title: "Script", overlay: false, inputs: [], plots: [], hlines: [], bgcolor: [], barcolor: [], shapes: [], alerts: [], logs: [], strategy: null, steps: 0 };
  private plotsById = new Map<string, PlotOut>();
  private hlineSeen = new Set<string>();
  private inputSeen = new Set<string>();
  private declared = false;

  // Strategy state
  private strat: StrategyEngine | null = null;

  constructor(
    private program: Program,
    private bars: ScriptBar[],
    private options: RunOptions,
  ) {
    this.maxSteps = options.maxSteps ?? LIMITS.steps;
  }

  run(): RunResult {
    const n = this.bars.length;
    this.result.bgcolor = new Array(n).fill(null);
    this.result.barcolor = new Array(n).fill(null);
    for (this.bar = 0; this.bar < n; this.bar++) {
      if (this.strat) this.strat.processBar(this.bar);
      this.declaredThisBar.clear();
      this.scopes = [];
      this.execBlock(this.program.body, false);
      for (const g of this.globals.values()) g.hist[this.bar] = g.cur;
      if (this.strat) this.strat.markEquity(this.bar);
    }
    if (!this.declared) throw new ScriptRuntimeError("A script must start with indicator(…) or strategy(…).", 1);
    for (const p of this.plotsById.values()) {
      p.values.length = n;
      for (let i = 0; i < n; i++) if (p.values[i] === undefined) p.values[i] = NaN;
    }
    this.result.plots = [...this.plotsById.values()];
    if (this.strat) this.result.strategy = this.strat.report();
    this.result.steps = this.steps;
    return this.result;
  }

  // ── statements ────────────────────────────────────────────────────────────
  private tick(line?: number) {
    if (++this.steps > this.maxSteps) throw new ScriptRuntimeError(`The script exceeded its instruction budget (${this.maxSteps.toLocaleString()} steps).`, line ?? null);
  }

  private execBlock(body: Stmt[], newScope = true): Value {
    if (newScope) this.scopes.push(new Map());
    let last: Value = null;
    try {
      for (const s of body) last = this.exec(s);
    } finally {
      if (newScope) this.scopes.pop();
    }
    return last;
  }

  private exec(s: Stmt): Value {
    this.tick(s.line);
    switch (s.k) {
      case "fn":
        this.fns.set(s.name, { params: s.params, body: s.body });
        return null;
      case "decl":
        this.declare(s.name, s.persist, s.e, s.line);
        return null;
      case "tupleDecl": {
        const v = this.eval(s.e);
        if (!Array.isArray(v)) throw new ScriptRuntimeError("The right-hand side doesn't return a tuple.", s.line);
        s.names.forEach((name, i) => {
          if (name !== "_") this.setNew(name, v[i] ?? null, false, s.line);
        });
        return null;
      }
      case "assign": {
        const cur = this.lookup(s.name, s.line);
        const v = this.eval(s.e);
        const next = s.op === ":=" ? v : arith(s.op[0], cur, v, s.line);
        this.reassign(s.name, next, s.line);
        return null;
      }
      case "expr":
        return this.eval(s.e);
      case "if":
        return this.execIf(s.branches);
      case "for": {
        const from = num(this.eval(s.from));
        const to = num(this.eval(s.to));
        const step = s.by ? Math.abs(num(this.eval(s.by))) : 1;
        if (!Number.isFinite(from) || !Number.isFinite(to) || !(step > 0)) return null;
        const dir = to >= from ? 1 : -1;
        let iter = 0;
        this.scopes.push(new Map());
        try {
          for (let i = from; dir > 0 ? i <= to : i >= to; i += dir * step) {
            if (++iter > LIMITS.loopIterations) throw new ScriptRuntimeError(`A loop exceeded ${LIMITS.loopIterations.toLocaleString()} iterations.`, s.line);
            this.scopes[this.scopes.length - 1].set(s.v, i);
            try {
              this.execBlock(s.body);
            } catch (e) {
              if (e instanceof Break) break;
              if (e instanceof Continue) continue;
              throw e;
            }
          }
        } finally {
          this.scopes.pop();
        }
        return null;
      }
      case "while": {
        let iter = 0;
        while (truthy(this.eval(s.cond))) {
          if (++iter > LIMITS.loopIterations) throw new ScriptRuntimeError(`A loop exceeded ${LIMITS.loopIterations.toLocaleString()} iterations.`, s.line);
          try {
            this.execBlock(s.body);
          } catch (e) {
            if (e instanceof Break) break;
            if (e instanceof Continue) continue;
            throw e;
          }
        }
        return null;
      }
      case "break":
        throw new Break();
      case "continue":
        throw new Continue();
    }
  }

  private execIf(branches: { cond: Expr | null; body: Stmt[] }[]): Value {
    for (const b of branches) {
      if (b.cond === null || truthy(this.eval(b.cond))) return this.execBlock(b.body);
    }
    return null;
  }

  // ── variables ─────────────────────────────────────────────────────────────
  private declare(name: string, persist: boolean, e: Expr, line: number) {
    if (this.scopes.length === 0) {
      const g = this.globals.get(name);
      if (g && g.persist && g.initialized) return; // `var`: initialised once
      if (this.declaredThisBar.has(name)) throw new ScriptRuntimeError(`"${name}" is already declared.`, line);
      const v = this.eval(e);
      this.declaredThisBar.add(name);
      if (g) {
        g.cur = v;
        g.initialized = true;
      } else this.globals.set(name, { cur: v, hist: [], persist, initialized: true });
      return;
    }
    if (persist) throw new ScriptRuntimeError("var declarations inside blocks or functions are not supported yet.", line);
    this.setNew(name, this.eval(e), false, line);
  }

  private setNew(name: string, v: Value, persist: boolean, line: number) {
    if (this.scopes.length === 0) {
      const g = this.globals.get(name);
      if (g) g.cur = v;
      else this.globals.set(name, { cur: v, hist: [], persist, initialized: true });
      this.declaredThisBar.add(name);
    } else {
      const scope = this.scopes[this.scopes.length - 1];
      if (scope.has(name)) throw new ScriptRuntimeError(`"${name}" is already declared.`, line);
      scope.set(name, v);
    }
  }

  private reassign(name: string, v: Value, line: number) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        this.scopes[i].set(name, v);
        return;
      }
    }
    const g = this.globals.get(name);
    if (!g) throw new ScriptRuntimeError(`"${name}" must be declared before := assigns to it.`, line);
    g.cur = v;
  }

  private lookup(name: string, line: number): Value {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name)!;
    const g = this.globals.get(name);
    if (g && (g.persist || this.declaredThisBar.has(name))) return g.cur;
    const b = this.builtinVar(name);
    if (b !== undefined) return b;
    if (g) return g.cur;
    throw new ScriptRuntimeError(`Undeclared identifier "${name}".`, line);
  }

  private history(name: string, n: number, line: number): Value {
    if (n === 0) return this.lookup(name, line);
    for (const s of this.scopes) if (s.has(name)) throw new ScriptRuntimeError(`History references to the local "${name}" aren't supported yet — use a global variable.`, line);
    const g = this.globals.get(name);
    if (g) {
      const i = this.bar - n;
      return i >= 0 ? (g.hist[i] ?? null) : null;
    }
    const i = this.bar - n;
    if (i < 0) return NaN;
    const series = this.builtinSeries(name, i);
    if (series === undefined) throw new ScriptRuntimeError(`Undeclared identifier "${name}".`, line);
    return series;
  }

  private builtinSeries(name: string, i: number): Value | undefined {
    const b = this.bars[i];
    switch (name) {
      case "open": return b.open;
      case "high": return b.high;
      case "low": return b.low;
      case "close": return b.close;
      case "volume": return b.volume;
      case "hl2": return (b.high + b.low) / 2;
      case "hlc3": return (b.high + b.low + b.close) / 3;
      case "ohlc4": return (b.open + b.high + b.low + b.close) / 4;
      case "hlcc4": return (b.high + b.low + 2 * b.close) / 4;
      case "time": return b.time * 60_000;
      case "bar_index": return i;
      case "hour": return Math.floor((((b.time % 1440) + 1440) % 1440) / 60);
      case "minute": return ((b.time % 60) + 60) % 60;
      case "dayofweek": return ((((Math.floor(b.time / 1440) + 4) % 7) + 7) % 7) + 1; // 1 = Sunday (as Pine)
      default: return undefined;
    }
  }

  private builtinVar(name: string): Value | undefined {
    const s = this.builtinSeries(name, this.bar);
    if (s !== undefined) return s;
    const last = this.bar === this.bars.length - 1;
    switch (name) {
      case "barstate.isfirst": return this.bar === 0;
      case "barstate.islast": return last;
      case "barstate.isconfirmed": return !(last && this.options.lastBarForming);
      case "barstate.ishistory": return !last;
      case "barstate.isrealtime": return false;
      case "last_bar_index": return this.bars.length - 1;
      case "strategy.long": return "long";
      case "strategy.short": return "short";
      case "strategy.fixed": return "fixed";
      case "strategy.cash": return "cash";
      case "strategy.percent_of_equity": return "percent_of_equity";
      case "math.pi": return Math.PI;
      case "math.e": return Math.E;
    }
    if (name.startsWith("color.")) return COLORS[name.slice(6)] ?? undefined;
    if (name.startsWith("strategy.") && this.strat) return this.strat.variable(name.slice(9));
    if (name.startsWith("strategy.")) return name.slice(9) === "position_size" ? 0 : undefined;
    if (/^(plot|shape|location|size|position|hline|display|extend|xloc|yloc|text|format|alert|barmerge|order|scale|currency|strategy\.commission|strategy\.direction)\./.test(name)) return name.split(".").pop()!;
    return undefined;
  }

  // ── expressions ───────────────────────────────────────────────────────────
  private site(key: string): Callsite {
    let s = this.sites.get(key);
    if (!s) this.sites.set(key, (s = { hist: [], state: {} }));
    return s;
  }
  private siteKey(id: number) {
    return this.stack.length ? `${this.stack.join("/")}/${id}` : String(id);
  }

  private eval(e: Expr): Value {
    this.tick();
    switch (e.k) {
      case "num": return e.v;
      case "str": return e.v;
      case "bool": return e.v;
      case "na": return NaN;
      case "color": return e.v.toLowerCase();
      case "ident": return this.lookup(e.name, e.line);
      case "member": {
        const v = this.builtinVar(e.path);
        if (v === undefined) throw new ScriptRuntimeError(`Unknown built-in "${e.path}".`, e.line);
        return v;
      }
      case "unary": {
        const v = this.eval(e.e);
        if (e.op === "not") return !truthy(v);
        return e.op === "-" ? -num(v) : num(v);
      }
      case "bin": {
        if (e.op === "and") return truthy(this.eval(e.l)) && truthy(this.eval(e.r));
        if (e.op === "or") return truthy(this.eval(e.l)) || truthy(this.eval(e.r));
        const l = this.eval(e.l);
        const r = this.eval(e.r);
        return binop(e.op, l, r, e.line);
      }
      case "ternary": return truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case "tuple": return e.items.map((x) => this.eval(x));
      case "ifx": return this.execIf(e.branches);
      case "hist": {
        const n = num(this.eval(e.n));
        if (!Number.isInteger(n) || n < 0) throw new ScriptRuntimeError("A history offset must be a non-negative integer.", e.line);
        if (e.e.k === "ident") return this.history(e.e.name, n, e.e.line);
        // Any other expression: record its value per bar at this call site.
        const site = this.site(this.siteKey(e.id));
        site.hist[this.bar] = this.eval(e.e);
        const i = this.bar - n;
        return i >= 0 ? (site.hist[i] ?? NaN) : NaN;
      }
      case "call": return this.call(e);
    }
  }

  private arg(e: Extract<Expr, { k: "call" }>, i: number, name: string, def?: Value): Value {
    if (e.named[name]) return this.eval(e.named[name]);
    if (e.args[i]) return this.eval(e.args[i]);
    if (def === undefined) throw new ScriptRuntimeError(`${e.fn}() needs "${name}".`, e.line);
    return def;
  }

  private call(e: Extract<Expr, { k: "call" }>): Value {
    const user = this.fns.get(e.fn);
    if (user) return this.callUser(e, user);
    const a = (i: number, name: string, def?: Value) => this.arg(e, i, name, def);
    const n = (i: number, name: string, def?: Value) => num(a(i, name, def));
    switch (e.fn) {
      case "indicator":
      case "strategy": {
        if (this.bar === 0) {
          this.declared = true;
          this.result.kind = e.fn;
          this.result.title = String(a(0, "title", "Script")).slice(0, 120);
          this.result.overlay = truthy(a(99, "overlay", false));
          if (e.fn === "strategy") {
            this.strat = new StrategyEngine(this.bars, {
              initialCapital: n(99, "initial_capital", 10_000),
              qtyType: String(a(99, "default_qty_type", "fixed")),
              qtyValue: n(99, "default_qty_value", 1),
              commissionType: String(a(99, "commission_type", "percent")),
              commissionValue: n(99, "commission_value", 0),
              pyramiding: n(99, "pyramiding", 1),
              lastBarForming: !!this.options.lastBarForming,
            });
          }
        }
        return null;
      }
      // Inputs: values come from the trader's settings, keyed by title.
      case "input":
      case "input.int":
      case "input.float":
      case "input.bool":
      case "input.string":
      case "input.source":
      case "input.color": {
        const defv = a(0, "defval");
        const title = String(a(1, "title", `Input ${this.inputSeen.size + 1}`));
        const type = e.fn === "input" ? (typeof defv === "boolean" ? "bool" : typeof defv === "string" ? "string" : "float") : (e.fn.slice(6) as InputDescriptor["type"]);
        if (!this.inputSeen.has(title)) {
          this.inputSeen.add(title);
          const d: InputDescriptor = { key: title, type, default: type === "source" ? sourceName(e) : defv };
          if (e.named.minval) d.min = num(this.eval(e.named.minval));
          if (e.named.maxval) d.max = num(this.eval(e.named.maxval));
          if (e.named.step) d.step = num(this.eval(e.named.step));
          if (e.named.options) d.options = (this.eval(e.named.options) as Value[]).map(String);
          this.result.inputs.push(d);
        }
        const set = this.options.inputs?.[title];
        if (type === "source") {
          const src = typeof set === "string" && ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "volume"].includes(set) ? set : sourceName(e);
          return this.builtinSeries(src, this.bar)!;
        }
        if (set === undefined || set === null) return defv;
        if (type === "int" || type === "float") {
          let v = num(set);
          if (!Number.isFinite(v)) return defv;
          const d = this.result.inputs.find((x) => x.key === title)!;
          if (d.min !== undefined) v = Math.max(d.min, v);
          if (d.max !== undefined) v = Math.min(d.max, v);
          return type === "int" ? Math.round(v) : v;
        }
        if (type === "bool") return set === true;
        return String(set).slice(0, LIMITS.string);
      }
      // Output
      case "plot":
      case "plotchar": {
        if (e.fn === "plotchar") return this.shape(e, true);
        const key = this.siteKey(e.id);
        let p = this.plotsById.get(key);
        if (!p) {
          if (this.plotsById.size >= LIMITS.plots) throw new ScriptRuntimeError(`At most ${LIMITS.plots} plots.`, e.line);
          p = { id: key, title: String(a(1, "title", `Plot ${this.plotsById.size + 1}`)), color: COLORS.blue, linewidth: 1, style: "line", values: [], colors: [] };
          this.plotsById.set(key, p);
        }
        const v = a(0, "series");
        const color = e.named.color ? this.eval(e.named.color) : COLORS.blue;
        p.values[this.bar] = typeof v === "boolean" ? (v ? 1 : 0) : num(v);
        p.colors[this.bar] = typeof color === "string" ? color : null;
        if (this.bar === 0 || p.color === COLORS.blue) p.color = typeof color === "string" ? color : p.color;
        if (e.named.linewidth) p.linewidth = Math.min(4, Math.max(1, Math.round(num(this.eval(e.named.linewidth)))));
        if (e.named.style) p.style = String(this.eval(e.named.style)).replace(/^style_/, "") as PlotOut["style"];
        return null;
      }
      case "plotshape":
        return this.shape(e, false);
      case "hline": {
        const key = this.siteKey(e.id);
        if (!this.hlineSeen.has(key)) {
          this.hlineSeen.add(key);
          this.result.hlines.push({ price: n(0, "price"), title: String(a(1, "title", "")), color: String(e.named.color ? this.eval(e.named.color) : COLORS.gray) });
        }
        return null;
      }
      case "bgcolor": {
        const c = a(0, "color");
        this.result.bgcolor[this.bar] = typeof c === "string" ? c : null;
        return null;
      }
      case "barcolor": {
        const c = a(0, "color");
        this.result.barcolor[this.bar] = typeof c === "string" ? c : null;
        return null;
      }
      case "fill":
        return null; // accepted; fills between plots are drawn by the chart from plot pairs (README)
      case "alertcondition": {
        if (truthy(a(0, "condition"))) this.result.alerts.push({ bar: this.bar, title: String(a(1, "title", "Alert")), message: String(a(2, "message", "")) });
        return null;
      }
      case "alert": {
        this.result.alerts.push({ bar: this.bar, title: "alert()", message: String(a(0, "message")).slice(0, LIMITS.string) });
        return null;
      }
      case "log.info":
      case "log.warning":
      case "log.error": {
        if (this.result.logs.length < LIMITS.logs) this.result.logs.push({ bar: this.bar, level: e.fn.slice(4) as "info", message: String(a(0, "message")).slice(0, LIMITS.string) });
        return null;
      }
      // Values
      case "na": {
        const v = a(0, "x");
        return v === null || (typeof v === "number" && Number.isNaN(v));
      }
      case "nz": {
        const v = a(0, "source");
        return typeof v === "number" && Number.isNaN(v) ? a(1, "replacement", 0) : v;
      }
      case "math.abs": return Math.abs(n(0, "number"));
      case "math.max": return Math.max(...e.args.map((x) => num(this.eval(x))));
      case "math.min": return Math.min(...e.args.map((x) => num(this.eval(x))));
      case "math.avg": return e.args.reduce((s, x) => s + num(this.eval(x)), 0) / e.args.length;
      case "math.sum": return this.stateful(e, "sum");
      case "math.round": {
        const p = n(1, "precision", 0);
        const f = 10 ** p;
        return Math.round(n(0, "number") * f) / f;
      }
      case "math.floor": return Math.floor(n(0, "number"));
      case "math.ceil": return Math.ceil(n(0, "number"));
      case "math.sqrt": return Math.sqrt(n(0, "number"));
      case "math.pow": return Math.pow(n(0, "base"), n(1, "exponent"));
      case "math.log": return Math.log(n(0, "number"));
      case "math.log10": return Math.log10(n(0, "number"));
      case "math.exp": return Math.exp(n(0, "number"));
      case "math.sign": return Math.sign(n(0, "number"));
      case "str.tostring": {
        const v = a(0, "value");
        return (typeof v === "number" && Number.isNaN(v) ? "NaN" : String(v)).slice(0, LIMITS.string);
      }
      case "color.new": {
        const c = String(a(0, "color"));
        const transp = Math.min(100, Math.max(0, n(1, "transp", 0)));
        const alpha = Math.round(((100 - transp) / 100) * 255).toString(16).padStart(2, "0");
        return c.slice(0, 7) + alpha;
      }
      case "color.rgb": {
        const hex = (x: number) => Math.min(255, Math.max(0, Math.round(x))).toString(16).padStart(2, "0");
        const transp = n(3, "transp", 0);
        return `#${hex(n(0, "red"))}${hex(n(1, "green"))}${hex(n(2, "blue"))}${hex(((100 - transp) / 100) * 255)}`;
      }
    }
    if (e.fn.startsWith("ta.")) return this.stateful(e, e.fn.slice(3));
    if (e.fn.startsWith("strategy.")) {
      if (!this.strat) throw new ScriptRuntimeError(`${e.fn}() needs a strategy(…) script.`, e.line);
      return this.strat.call(e.fn.slice(9), e, a, this.bar);
    }
    throw new ScriptRuntimeError(`Unknown function "${e.fn}" (not supported in Traditorium Script yet).`, e.line);
  }

  private shape(e: Extract<Expr, { k: "call" }>, isChar: boolean): Value {
    const cond = this.arg(e, 0, "series");
    if (!truthy(cond) || (typeof cond === "number" && Number.isNaN(cond))) return null;
    if (this.result.shapes.length >= LIMITS.shapes) return null;
    const named = (k: string, def: Value) => (e.named[k] ? this.eval(e.named[k]) : def);
    this.result.shapes.push({
      bar: this.bar,
      title: String(named("title", "")),
      location: String(named("location", "abovebar")) as ShapeOut["location"],
      style: String(named(isChar ? "char" : "style", isChar ? "•" : "circle")),
      color: String(named("color", COLORS.blue)),
      text: String(named("text", "")).slice(0, 64),
      price: typeof cond === "number" && !Number.isNaN(cond) && cond !== 1 ? cond : null,
    });
    return null;
  }

  private callUser(e: Extract<Expr, { k: "call" }>, fn: Fn): Value {
    if (this.stack.length > 64) throw new ScriptRuntimeError("Too much recursion.", e.line);
    const scope = new Map<string, Value>();
    fn.params.forEach((p, i) => {
      const supplied = e.named[p.name] ?? e.args[i];
      const v = supplied ? this.eval(supplied) : p.def ? this.eval(p.def) : null;
      if (v === null && !p.def && !supplied) throw new ScriptRuntimeError(`${e.fn}() needs "${p.name}".`, e.line);
      scope.set(p.name, v);
    });
    const saved = this.scopes;
    this.scopes = [scope];
    this.stack.push(e.id);
    try {
      return this.execBlock(fn.body, false);
    } finally {
      this.stack.pop();
      this.scopes = saved;
    }
  }

  /**
   * Stateful built-ins. Each call site appends this bar's inputs to its own
   * buffers and returns the value at the current bar, computed by the tested
   * batch functions in domain/indicators/ta (incrementally for SMA/EMA/RMA).
   */
  private stateful(e: Extract<Expr, { k: "call" }>, name: string): Value {
    const site = this.site(this.siteKey(e.id));
    const st = site.state as { bufs?: number[][]; last?: number; prev?: number; win?: number[]; i?: number };
    const a = (i: number, key: string, def?: Value) => this.arg(e, i, key, def);
    const push = (...vals: number[]) => {
      st.bufs ??= vals.map(() => []);
      vals.forEach((v, k) => (st.bufs![k][this.bar] = v));
      return st.bufs.map((b) => {
        for (let k = 0; k < this.bar; k++) if (b[k] === undefined) b[k] = NaN;
        return b;
      });
    };
    const len = (i: number) => {
      const v = num(a(i, "length"));
      if (!Number.isInteger(v) || v < 1) throw new ScriptRuntimeError(`ta.${name}: length must be a positive integer.`, e.line);
      return v;
    };
    const lastOf = (s: number[]) => s[s.length - 1];
    const b = this.bars;
    switch (name) {
      case "sma":
      case "ema":
      case "rma": {
        const v = num(a(0, "source"));
        const l = len(1);
        st.win ??= [];
        st.win.push(v);
        if (st.win.length > l) st.win.shift();
        if (name === "sma") return st.win.length === l && st.win.every(Number.isFinite) ? st.win.reduce((s, x) => s + x, 0) / l : NaN;
        const alpha = name === "ema" ? 2 / (l + 1) : 1 / l;
        if (!Number.isFinite(st.prev ?? NaN)) {
          if (st.win.length === l && st.win.every(Number.isFinite)) st.prev = st.win.reduce((s, x) => s + x, 0) / l;
        } else if (Number.isFinite(v)) st.prev = alpha * v + (1 - alpha) * st.prev!;
        return st.prev ?? NaN;
      }
      case "wma": return lastOf(ta.wma(push(num(a(0, "source")))[0], len(1)));
      case "vwma": {
        const [s, vol] = push(num(a(0, "source")), b[this.bar].volume);
        return lastOf(ta.vwma(s, vol, len(1)));
      }
      case "stdev": return lastOf(ta.stdev(push(num(a(0, "source")))[0], len(1)));
      case "highest": {
        if (e.args.length === 1 && !e.named.source) return lastOf(ta.highest(push(b[this.bar].high)[0], len(0)));
        return lastOf(ta.highest(push(num(a(0, "source")))[0], len(1)));
      }
      case "lowest": {
        if (e.args.length === 1 && !e.named.source) return lastOf(ta.lowest(push(b[this.bar].low)[0], len(0)));
        return lastOf(ta.lowest(push(num(a(0, "source")))[0], len(1)));
      }
      case "change": return lastOf(ta.change(push(num(a(0, "source")))[0], num(a(1, "length", 1))));
      case "mom": return lastOf(ta.mom(push(num(a(0, "source")))[0], len(1)));
      case "roc": return lastOf(ta.roc(push(num(a(0, "source")))[0], len(1)));
      case "rsi": return lastOf(ta.rsi(push(num(a(0, "source")))[0], len(1)));
      case "cci": return lastOf(ta.cci(push(num(a(0, "source")))[0], len(1)));
      case "tr": {
        const [h, l, c] = push(b[this.bar].high, b[this.bar].low, b[this.bar].close);
        return lastOf(ta.trueRange(h, l, c));
      }
      case "atr": {
        const [h, l, c] = push(b[this.bar].high, b[this.bar].low, b[this.bar].close);
        return lastOf(ta.atr(h, l, c, len(0)));
      }
      case "stoch": {
        const [c, h, l] = push(num(a(0, "source")), num(a(1, "high")), num(a(2, "low")));
        return lastOf(ta.stoch(c, h, l, num(a(3, "length"))));
      }
      case "macd": {
        const r = ta.macd(push(num(a(0, "source")))[0], num(a(1, "fastlen")), num(a(2, "slowlen")), num(a(3, "siglen")));
        return [lastOf(r.macd), lastOf(r.signal), lastOf(r.histogram)];
      }
      case "bb": {
        const [s] = push(num(a(0, "series")));
        const l = len(1);
        const mult = num(a(2, "mult"));
        const basis = lastOf(ta.sma(s, l));
        const dev = lastOf(ta.stdev(s, l));
        return [basis, basis + mult * dev, basis - mult * dev];
      }
      case "dmi": {
        const [h, l, c] = push(b[this.bar].high, b[this.bar].low, b[this.bar].close);
        const r = ta.dmi(h, l, c, num(a(0, "diLength")), num(a(1, "adxSmoothing")));
        return [lastOf(r.plus), lastOf(r.minus), lastOf(r.adx)];
      }
      case "supertrend": {
        const [h, l, c] = push(b[this.bar].high, b[this.bar].low, b[this.bar].close);
        const r = ta.supertrend(h, l, c, num(a(0, "factor")), num(a(1, "atrPeriod")));
        return [lastOf(r.line), lastOf(r.direction)];
      }
      case "vwap": {
        const [s, v, d] = push(num(a(0, "source")), b[this.bar].volume, Math.floor(b[this.bar].time / 1440));
        return lastOf(ta.vwap(s, v, d));
      }
      case "obv": {
        const [c, v] = push(b[this.bar].close, b[this.bar].volume);
        return lastOf(ta.obv(c, v));
      }
      case "crossover":
      case "crossunder":
      case "cross": {
        const x = num(a(0, "source1"));
        const y = num(a(1, "source2"));
        const prev = st.win as number[] | undefined;
        st.win = [x, y];
        if (!prev) return false;
        const over = x > y && prev[0] <= prev[1];
        const under = x < y && prev[0] >= prev[1];
        return name === "crossover" ? over : name === "crossunder" ? under : over || under;
      }
      case "cum": {
        const v = num(a(0, "source"));
        st.prev = (st.prev ?? 0) + (Number.isFinite(v) ? v : 0);
        return st.prev;
      }
      case "sum": {
        const v = num(a(0, "source"));
        const l = len(1);
        st.win ??= [];
        st.win.push(v);
        if (st.win.length > l) st.win.shift();
        return st.win.length === l ? st.win.reduce((s, x) => s + x, 0) : NaN;
      }
      case "barssince": {
        const c = truthy(a(0, "condition"));
        if (c) st.last = this.bar;
        return st.last === undefined ? NaN : this.bar - st.last;
      }
      case "valuewhen": {
        const c = truthy(a(0, "condition"));
        const v = num(a(1, "source"));
        const occ = num(a(2, "occurrence", 0));
        st.win ??= [];
        if (c) st.win.unshift(v);
        if (st.win.length > 500) st.win.pop();
        return st.win[occ] ?? NaN;
      }
      case "pivothigh":
      case "pivotlow": {
        // ta.pivothigh(leftbars, rightbars) on high/low: the pivot is confirmed rightbars later (no lookahead).
        const left = num(a(e.args.length >= 3 ? 1 : 0, "leftbars"));
        const right = num(a(e.args.length >= 3 ? 2 : 1, "rightbars"));
        const src = e.args.length >= 3 ? num(a(0, "source")) : name === "pivothigh" ? b[this.bar].high : b[this.bar].low;
        const [s] = push(src);
        const c = this.bar - right;
        if (c - left < 0) return NaN;
        const v = s[c];
        for (let k = c - left; k <= c + right; k++) {
          if (k === c) continue;
          if (name === "pivothigh" ? s[k] >= v : s[k] <= v) return NaN;
        }
        return v;
      }
    }
    throw new ScriptRuntimeError(`ta.${name} is not supported in Traditorium Script yet.`, e.line);
  }
}

function sourceName(e: Extract<Expr, { k: "call" }>): string {
  const d = e.named.defval ?? e.args[0];
  return d && d.k === "ident" ? d.name : "close";
}

// ── value helpers ───────────────────────────────────────────────────────────
function num(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function truthy(v: Value): boolean {
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  return !!v;
}

function arith(op: string, l: Value, r: Value, line: number): Value {
  return binop(op, l, r, line);
}

function binop(op: string, l: Value, r: Value, line: number): Value {
  if (op === "+" && (typeof l === "string" || typeof r === "string")) return (String(l) + String(r)).slice(0, LIMITS.string);
  if (op === "==") return typeof l === "number" && typeof r === "number" ? l === r : l === r;
  if (op === "!=") return typeof l === "number" && typeof r === "number" ? l !== r : l !== r;
  const a = num(l);
  const b = num(r);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? NaN : a / b;
    case "%": return b === 0 ? NaN : a % b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
  }
  throw new ScriptRuntimeError(`Unknown operator ${op}.`, line);
}

// ── Strategy engine ─────────────────────────────────────────────────────────

interface StrategySettings {
  initialCapital: number;
  qtyType: string;
  qtyValue: number;
  commissionType: string;
  commissionValue: number;
  pyramiding: number;
  lastBarForming: boolean;
}

interface PendingOrder {
  kind: "entry" | "close" | "exit";
  id: string;
  fromEntry?: string;
  side?: "long" | "short";
  qty?: number;
  limit?: number;
  stop?: number;
  placedBar: number;
}

/**
 * Strategy Tester simulation (subset). One net position. Orders placed while
 * the script runs on bar i are processed on bar i+1:
 *   market → fills at bar i+1's open;
 *   stop / limit entries and exits → fill when bar i+1+ touches the level
 *     (a bar that opens through the level fills at the open);
 *   a bar touching both an exit's stop and its limit → the stop fills first
 *     (conservative; OHLC can't order them).
 * P&L = price difference × quantity (no contract multiplier). Commission:
 * percent of traded value, or cash per order / per contract.
 */
class StrategyEngine {
  private cash: number;
  private pos: { side: "long" | "short"; qty: number; avg: number; entryBar: number; entryId: string } | null = null;
  private orders: PendingOrder[] = [];
  private trades: TradeOut[] = [];
  private equity: number[] = [];
  private commissionPaid = 0;
  private peak: number;
  private maxDd = 0;

  constructor(
    private bars: ScriptBar[],
    private s: StrategySettings,
  ) {
    this.cash = s.initialCapital;
    this.peak = s.initialCapital;
  }

  private commission(price: number, qty: number): number {
    const v = this.s.commissionValue;
    if (!(v > 0)) return 0;
    if (this.s.commissionType === "cash_per_order") return v;
    if (this.s.commissionType === "cash_per_contract") return v * qty;
    return (price * qty * v) / 100;
  }

  private openPnl(price: number): number {
    if (!this.pos) return 0;
    return (this.pos.side === "long" ? price - this.pos.avg : this.pos.avg - price) * this.pos.qty;
  }

  private closePosition(bar: number, price: number, reason: string) {
    if (!this.pos) return;
    const fee = this.commission(price, this.pos.qty);
    const pnl = this.openPnl(price) - fee;
    this.cash += pnl;
    this.commissionPaid += fee;
    this.trades.push({ side: this.pos.side, entryId: this.pos.entryId, qty: this.pos.qty, entryBar: this.pos.entryBar, entryPrice: this.pos.avg, exitBar: bar, exitPrice: price, pnl, exitReason: reason });
    this.pos = null;
    this.orders = this.orders.filter((o) => o.kind !== "exit");
  }

  private openPosition(bar: number, side: "long" | "short", qty: number, price: number, id: string) {
    if (this.pos && this.pos.side !== side) this.closePosition(bar, price, `Reversed by ${id}`);
    const fee = this.commission(price, qty);
    this.cash -= fee;
    this.commissionPaid += fee;
    if (this.pos && this.pos.side === side) {
      const total = this.pos.qty + qty;
      this.pos.avg = (this.pos.avg * this.pos.qty + price * qty) / total;
      this.pos.qty = total;
    } else this.pos = { side, qty, avg: price, entryBar: bar, entryId: id };
  }

  /** Processes orders placed on earlier bars against bar `i`. */
  processBar(i: number) {
    const b = this.bars[i];
    const remaining: PendingOrder[] = [];
    for (const o of this.orders) {
      if (o.placedBar >= i) {
        remaining.push(o);
        continue;
      }
      if (o.kind === "close") {
        if (this.pos && (o.id === "*" || this.pos.entryId === o.id)) this.closePosition(i, b.open, o.id === "*" ? "Close all" : `Close ${o.id}`);
        continue;
      }
      if (o.kind === "entry") {
        const fill = this.touch(o.side === "long" ? "buy" : "sell", o.limit, o.stop, b);
        if (fill == null) remaining.push(o);
        else if (!(this.pos && this.pos.side === o.side && this.pos.qty > 0 && this.s.pyramiding <= 1)) this.openPosition(i, o.side!, o.qty!, fill, o.id);
        continue;
      }
      remaining.push(o); // exits are evaluated below, against the position
    }
    this.orders = remaining;
    if (!this.pos) return;
    for (const o of this.orders.filter((x) => x.kind === "exit" && x.placedBar < i)) {
      if (o.fromEntry && o.fromEntry !== this.pos.entryId) continue;
      const long = this.pos.side === "long";
      // Stop first (conservative), then limit.
      if (o.stop != null && (long ? b.low <= o.stop : b.high >= o.stop)) {
        this.closePosition(i, long ? Math.min(b.open, o.stop) : Math.max(b.open, o.stop), `Stop ${o.id}`);
        break;
      }
      if (o.limit != null && (long ? b.high >= o.limit : b.low <= o.limit)) {
        this.closePosition(i, long ? Math.max(b.open, o.limit) : Math.min(b.open, o.limit), `Limit ${o.id}`);
        break;
      }
    }
  }

  /** Fill price for an entry on bar b: market (open), or when a limit/stop is touched. */
  private touch(side: "buy" | "sell", limit: number | undefined, stop: number | undefined, b: ScriptBar): number | null {
    if (limit == null && stop == null) return b.open;
    if (side === "buy") {
      if (stop != null) return b.open >= stop ? b.open : b.high >= stop ? stop : null;
      return b.open <= limit! ? b.open : b.low <= limit! ? limit! : null;
    }
    if (stop != null) return b.open <= stop ? b.open : b.low <= stop ? stop : null;
    return b.open >= limit! ? b.open : b.high >= limit! ? limit! : null;
  }

  markEquity(i: number) {
    const eq = this.cash + this.openPnl(this.bars[i].close);
    this.equity[i] = eq;
    this.peak = Math.max(this.peak, eq);
    this.maxDd = Math.max(this.maxDd, this.peak - eq);
  }

  private qtyFor(price: number): number {
    if (this.s.qtyType === "cash") return this.s.qtyValue / price;
    if (this.s.qtyType === "percent_of_equity") return ((this.cash + this.openPnl(price)) * this.s.qtyValue) / 100 / price;
    return this.s.qtyValue;
  }

  variable(name: string): Value | undefined {
    const price = this.bars[Math.min(this.equity.length, this.bars.length - 1)]?.close ?? 0;
    switch (name) {
      case "position_size": return this.pos ? (this.pos.side === "long" ? this.pos.qty : -this.pos.qty) : 0;
      case "position_avg_price": return this.pos ? this.pos.avg : NaN;
      case "equity": return this.cash + this.openPnl(price);
      case "netprofit": return this.cash - this.s.initialCapital;
      case "openprofit": return this.openPnl(price);
      case "closedtrades": return this.trades.length;
      case "opentrades": return this.pos ? 1 : 0;
      case "wintrades": return this.trades.filter((t) => t.pnl > 0).length;
      case "losstrades": return this.trades.filter((t) => t.pnl < 0).length;
      case "initial_capital": return this.s.initialCapital;
    }
    return undefined;
  }

  call(name: string, e: Extract<Expr, { k: "call" }>, a: (i: number, key: string, def?: Value) => Value, bar: number): Value {
    const optNum = (key: string, i: number) => {
      const v = e.named[key] || e.args[i] ? num(a(i, key, NaN)) : NaN;
      return Number.isFinite(v) ? v : undefined;
    };
    const blocked = bar === this.bars.length - 1 && this.s.lastBarForming;
    switch (name) {
      case "entry": {
        const id = String(a(0, "id"));
        const dir = String(a(1, "direction"));
        if (dir !== "long" && dir !== "short") throw new ScriptRuntimeError("strategy.entry direction must be strategy.long or strategy.short.", e.line);
        const price = this.bars[bar].close;
        const qty = optNum("qty", 2) ?? this.qtyFor(price);
        if (!(qty > 0)) return null;
        if (!blocked) {
          this.orders = this.orders.filter((o) => !(o.kind === "entry" && o.id === id));
          this.orders.push({ kind: "entry", id, side: dir, qty, limit: optNum("limit", 3), stop: optNum("stop", 4), placedBar: bar });
        }
        return null;
      }
      case "close": {
        if (!blocked) this.orders.push({ kind: "close", id: String(a(0, "id")), placedBar: bar });
        return null;
      }
      case "close_all": {
        if (!blocked) this.orders.push({ kind: "close", id: "*", placedBar: bar });
        return null;
      }
      case "exit": {
        const id = String(a(0, "id"));
        const fromEntry = e.named.from_entry || e.args[1] ? String(a(1, "from_entry")) : undefined;
        let stop = optNum("stop", 99);
        let limit = optNum("limit", 99);
        const tick = 10 ** -6;
        if (this.pos) {
          const ticks = (k: string) => optNum(k, 99);
          const long = this.pos.side === "long";
          if (ticks("loss") !== undefined && stop === undefined) stop = this.pos.avg + (long ? -1 : 1) * ticks("loss")! * tick;
          if (ticks("profit") !== undefined && limit === undefined) limit = this.pos.avg + (long ? 1 : -1) * ticks("profit")! * tick;
        }
        if (stop === undefined && limit === undefined) return null;
        if (!blocked) {
          this.orders = this.orders.filter((o) => !(o.kind === "exit" && o.id === id));
          this.orders.push({ kind: "exit", id, fromEntry, stop, limit, placedBar: bar });
        }
        return null;
      }
      case "cancel": {
        const id = String(a(0, "id"));
        this.orders = this.orders.filter((o) => o.id !== id);
        return null;
      }
      case "cancel_all":
        this.orders = [];
        return null;
    }
    throw new ScriptRuntimeError(`strategy.${name} is not supported in Traditorium Script yet.`, e.line);
  }

  report(): StrategyReport {
    const wins = this.trades.filter((t) => t.pnl > 0);
    const losses = this.trades.filter((t) => t.pnl < 0);
    const gp = wins.reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const last = this.bars[this.bars.length - 1];
    return {
      initialCapital: this.s.initialCapital,
      netProfit: this.cash - this.s.initialCapital,
      grossProfit: gp,
      grossLoss: gl,
      profitFactor: gl > 0 ? gp / gl : null,
      totalTrades: this.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: this.trades.length ? (wins.length / this.trades.length) * 100 : null,
      maxDrawdown: this.maxDd,
      commissionPaid: this.commissionPaid,
      openPosition: this.pos && last ? { side: this.pos.side, qty: this.pos.qty, avgPrice: this.pos.avg, openPnl: this.openPnl(last.close) } : null,
      trades: this.trades,
      equity: this.equity,
    };
  }
}

export { ScriptSyntaxError };
