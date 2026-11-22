/**
 * Pure render model for a chart: market candles → displayed bars (chart type
 * transform) → study outputs (built-in indicators and script results), all
 * aligned to the displayed bars. No chart library here — it is unit tested.
 *
 * Studies are calculated on the DISPLAYED bars: on Heikin Ashi, Renko, etc.
 * they use the synthetic values (the legend says so). Volume is tick volume
 * and only exists for plain (non-synthetic) types.
 */
import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { CHART_TYPES, transform, type ChartCandle, type ChartTypeKey } from "@/domain/indicators/chart-types";
import { INDICATOR_BY_ID, sanitizeInputs, type IndicatorBar } from "@/domain/indicators/catalog";
import type { RunResult } from "@/domain/scripting/runtime";
import type { ChartConfig } from "./workspace";

export interface DisplayBar extends ChartCandle {
  volume: number | null;
}

export interface Display {
  bars: DisplayBar[];
  /** The same bars in the shape indicators and scripts take (time = source minute). */
  inputs: IndicatorBar[];
  synthetic: boolean;
  /** The last displayed bar is still forming (replay): not final. */
  lastForming: boolean;
}

export function buildDisplay(candles: EngineCandle[], priceDigits: number, chartType: ChartTypeKey, param: number | null): Display {
  const s = 10 ** priceDigits;
  const ohlc = candles.map((c) => ({ time: c.time, open: c.open / s, high: c.high / s, low: c.low / s, close: c.close / s }));
  const synthetic = CHART_TYPES.find((t) => t.key === chartType)?.synthetic ?? false;
  const out = transform(chartType, ohlc, param, priceDigits);
  const vol = new Map(candles.map((c) => [c.time, c.tickVolume]));
  const plainVolume = !synthetic || chartType === "heikinashi";
  const bars: DisplayBar[] = out.map((b) => ({ ...b, volume: plainVolume ? (vol.get(b.sourceMinute) ?? null) : null }));
  const lastCandle = candles[candles.length - 1];
  const lastForming = !!lastCandle && lastCandle.state === "FORMING" && (bars[bars.length - 1]?.sourceMinute === lastCandle.time || !!bars[bars.length - 1]?.forming);
  return {
    bars,
    inputs: bars.map((b) => ({ time: b.sourceMinute, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })),
    synthetic,
    lastForming,
  };
}

export type PlotKind = "line" | "histogram" | "dots" | "area" | "step";

export interface PlotRender {
  key: string;
  title: string;
  kind: PlotKind;
  color: string;
  width: number;
  values: number[];
  /** Per-bar colours (scripts); null entries use `color`. */
  colors?: (string | null)[];
}

export interface StudyRender {
  uid: string;
  name: string;
  /** Short parameter summary for the legend ("14, close"). */
  params: string;
  overlay: boolean;
  visible: boolean;
  /** Decimals for this study's values (price digits on the price pane, by magnitude elsewhere). */
  digits: number;
  plots: PlotRender[];
  levels: { price: number; color: string; title: string }[];
  markers: { bar: number; position: "aboveBar" | "belowBar" | "inBar"; shape: "circle" | "square" | "arrowUp" | "arrowDown"; color: string; text: string }[];
  bgcolor: (string | null)[] | null;
  barcolor: (string | null)[] | null;
  error: string | null;
  kind: "indicator" | "script";
  scriptKind?: "indicator" | "strategy";
}

export type ScriptState = { status: "running" } | { status: "ok"; result: RunResult; name: string } | { status: "error"; message: string; name: string };

const SHAPE: Record<string, StudyRender["markers"][number]["shape"]> = {
  triangleup: "arrowUp", arrowup: "arrowUp", labelup: "arrowUp", triangledown: "arrowDown", arrowdown: "arrowDown", labeldown: "arrowDown", square: "square", diamond: "square", circle: "circle", xcross: "circle", cross: "circle", flag: "square",
};

function scriptPlotKind(style: string): PlotKind {
  if (style === "histogram" || style === "columns") return "histogram";
  if (style === "circles" || style === "cross") return "dots";
  if (style === "area") return "area";
  if (style === "stepline") return "step";
  return "line";
}

/** Decimals that show ~3 significant digits of the largest value (2–8). */
export function digitsFor(plots: { values: number[] }[]): number {
  let max = 0;
  for (const p of plots) for (const v of p.values) if (Number.isFinite(v)) max = Math.max(max, Math.abs(v));
  if (max === 0) return 2;
  return Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(max))));
}

export function buildStudies(display: Display, config: ChartConfig, scripts: Map<string, ScriptState>, priceDigits = 5): StudyRender[] {
  const out: StudyRender[] = [];
  const withDigits = (st: Omit<StudyRender, "digits">): StudyRender => ({ ...st, digits: st.overlay ? priceDigits : digitsFor(st.plots) });
  for (const st of config.studies) {
    if (st.kind === "indicator") {
      const def = INDICATOR_BY_ID.get(st.id);
      if (!def) continue;
      const inputs = sanitizeInputs(def, st.inputs);
      const values = display.inputs.length ? def.compute(display.inputs, inputs) : {};
      out.push(withDigits({
        uid: st.uid,
        name: def.name,
        params: def.inputs.map((i) => String(inputs[i.key])).join(", "),
        overlay: def.overlay,
        visible: st.visible,
        plots: def.plots.map((p) => ({ key: p.key, title: p.label, kind: p.kind, color: p.color, width: 1, values: values[p.key] ?? [] })),
        levels: (def.levels ?? []).map((l) => ({ price: l, color: "#787b86", title: "" })),
        markers: [],
        bgcolor: null,
        barcolor: null,
        error: null,
        kind: "indicator",
      }));
      continue;
    }
    const state = scripts.get(st.uid);
    const base = { uid: st.uid, params: "", visible: st.visible, levels: [], markers: [], bgcolor: null, barcolor: null, kind: "script" as const };
    if (!state || state.status === "running") {
      out.push(withDigits({ ...base, name: "Script", overlay: true, plots: [], error: null }));
      continue;
    }
    if (state.status === "error") {
      out.push(withDigits({ ...base, name: state.name, overlay: true, plots: [], error: state.message }));
      continue;
    }
    const r = state.result;
    const hasBg = r.bgcolor.some(Boolean);
    const hasBar = r.barcolor.some(Boolean);
    out.push(withDigits({
      ...base,
      name: r.title || state.name,
      params: r.inputs.map((i) => String(st.inputs[i.key] ?? i.default)).join(", "),
      overlay: r.overlay,
      scriptKind: r.kind,
      plots: r.plots.map((p) => ({ key: p.id, title: p.title, kind: scriptPlotKind(p.style), color: p.color, width: p.linewidth, values: p.values, colors: p.colors })),
      levels: r.hlines.map((h) => ({ price: h.price, color: h.color, title: h.title })),
      markers: r.shapes.map((s) => ({
        bar: s.bar,
        position: s.location === "belowbar" || s.location === "bottom" ? "belowBar" : s.location === "absolute" ? "inBar" : "aboveBar",
        shape: SHAPE[s.style.replace(/^shape\./, "")] ?? (s.location === "belowbar" ? "arrowUp" : "circle"),
        color: s.color,
        text: s.text,
      })),
      bgcolor: hasBg ? r.bgcolor : null,
      barcolor: hasBar ? r.barcolor : null,
      error: null,
    }));
  }
  return out;
}

/** Structural signature: when it changes the chart rebuilds its study series/panes. */
export function studySignature(studies: StudyRender[], showVolume: boolean): string {
  return JSON.stringify([showVolume, studies.map((s) => [s.uid, s.overlay, s.visible, s.digits, !!s.bgcolor, s.plots.map((p) => [p.key, p.kind, p.color, p.width]), s.levels.map((l) => l.price)])]);
}

/** Index of the displayed bar at or before chart time `t` (seconds), or -1. */
export function barIndexAt(bars: { time: number }[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
