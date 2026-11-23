/**
 * Client-side chart compute benchmark (runs in Node; the browser's V8 is
 * comparable). Times what a chart does with its candles: chart-type
 * transform + every study, full recompute vs. the incremental path.
 * Run: npx tsx scripts/bench/chart-compute.bench.ts
 */
import { performance } from "node:perf_hooks";

import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { buildDisplay, buildStudies } from "@/domain/charting/render-model";
import { chartConfigSchema } from "@/domain/charting/workspace";

const N = 1500;
const candles: EngineCandle[] = Array.from({ length: N }, (_, i) => {
  const c = 108000 + Math.round(Math.sin(i / 17) * 400 + Math.cos(i / 5) * 60);
  return { time: 28_000_000 + i * 15, open: c - 15, high: c + 40, low: c - 45, close: c, tickVolume: 100 + (i % 37), realVolume: null, spread: 8, barCount: 15, lastBarTime: 28_000_000 + i * 15 + 14, state: i === N - 1 ? "FORMING" : "COMPLETED" };
});
const ids = ["sma", "bb", "rsi", "macd", "ema", "atr", "stoch", "supertrend", "ichimoku", "adx", "vwap", "cci"];
function cfg(n: number) {
  return chartConfigSchema.parse({ studies: ids.slice(0, n).map((id, i) => ({ uid: `s${i}`, kind: "indicator", id })) });
}
function time(label: string, runs: number, fn: () => void) {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(52)} median ${ms[Math.floor(runs / 2)].toFixed(2).padStart(7)} ms`);
}
for (const k of [4, 12]) {
  const c = cfg(k);
  time(`full: transform + ${k} studies, ${N} candles`, 40, () => buildStudies(buildDisplay(candles, 5, "candles", null), c, new Map()));
}
time(`Heikin Ashi transform, ${N} candles`, 40, () => buildDisplay(candles, 5, "heikinashi", null));
time(`Renko transform, ${N} candles`, 40, () => buildDisplay(candles, 5, "renko", null));
for (const id of ids) {
  const c = chartConfigSchema.parse({ studies: [{ uid: "x", kind: "indicator", id }] });
  const d = buildDisplay(candles, 5, "candles", null);
  time(`  ${id}`, 20, () => buildStudies(d, c, new Map()));
}
