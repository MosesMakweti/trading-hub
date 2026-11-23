/**
 * Script runtime benchmark: one full run of each template and of a script
 * using every rolling ta.* function, on N bars. Run: npx tsx scripts/bench/script-run.bench.ts
 */
import { performance } from "node:perf_hooks";

import { SCRIPT_TEMPLATES } from "@/domain/scripting/builtins";
import { run, type ScriptBar } from "@/domain/scripting/runtime";

const heavy = `//@version=6
indicator("all rolling ta", overlay = false)
plot(ta.atr(14))
plot(ta.rsi(close, 14))
plot(ta.stdev(close, 20))
plot(ta.wma(close, 20))
plot(ta.highest(high, 20) - ta.lowest(low, 20))
plot(ta.cci(close, 20))
[m, s, h] = ta.macd(close, 12, 26, 9)
plot(h)
[b, u, l] = ta.bb(close, 20, 2)
plot(u - l)
plot(ta.stoch(close, high, low, 14))
[p, mi, adx] = ta.dmi(14, 14)
plot(adx)
`;
for (const n of [1500, 5000]) {
  const bars: ScriptBar[] = Array.from({ length: n }, (_, i) => {
    const c = 1.08 + Math.sin(i / 23) * 0.01 + Math.cos(i / 7) * 0.002;
    return { time: 28_000_000 + i, open: c - 0.0002, high: c + 0.0006, low: c - 0.0006, close: c, volume: 10 + (i % 9) };
  });
  for (const [name, src] of [...SCRIPT_TEMPLATES.map((t) => [t.label, t.source] as const), ["all rolling ta", heavy] as const]) {
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      run(src, bars);
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    console.log(`${String(n).padStart(5)} bars  ${name.padEnd(16)} median ${ms[2].toFixed(1).padStart(8)} ms`);
  }
}
