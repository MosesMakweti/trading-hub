/**
 * Native Replay test fixtures — build canonical M1 bars / MT5 export text
 * from explicit values so expected candles can be hand-calculated.
 */
import type { CanonicalM1Bars } from "../m1-dataset";
import { parseWallClock, type WallClockMinute } from "../wall-clock";

export interface FixtureBar {
  t: string; // "YYYY-MM-DDTHH:mm" wall clock
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number; // tick volume
  s?: number; // spread
}

export function wc(t: string): WallClockMinute {
  const m = parseWallClock(t);
  if (m == null) throw new Error(`bad fixture time ${t}`);
  return m;
}

/** Integer-priced bars (already × 10^scale). */
export function barsOf(list: FixtureBar[], opts: { spread?: boolean } = {}): CanonicalM1Bars {
  const n = list.length;
  const bars: CanonicalM1Bars = {
    count: n,
    minute: new Int32Array(n),
    open: new Int32Array(n),
    high: new Int32Array(n),
    low: new Int32Array(n),
    close: new Int32Array(n),
    tickVolume: new Int32Array(n),
    realVolume: null,
    spread: opts.spread ? new Int32Array(n) : null,
  };
  list.forEach((b, i) => {
    bars.minute[i] = wc(b.t);
    bars.open[i] = b.o;
    bars.high[i] = b.h;
    bars.low[i] = b.l;
    bars.close[i] = b.c;
    bars.tickVolume![i] = b.v ?? 1;
    if (bars.spread) bars.spread[i] = b.s ?? 0;
  });
  return bars;
}

/** Consecutive M1 bars from `start`, one per entry of `closes`: each bar opens at the previous close. */
export function walk(start: string, closes: number[], opts: { wick?: number; volume?: number } = {}): FixtureBar[] {
  const wick = opts.wick ?? 2;
  const t0 = wc(start);
  let prev = closes[0];
  return closes.map((c, i) => {
    const o = prev;
    prev = c;
    return { t: fmt(t0 + i), o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: opts.volume ?? 10 };
  });
}

function fmt(m: number): string {
  const d = new Date(m * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** MT5 "Export Bars" text (tab-delimited, with header) from decimal-string rows. */
export function mt5Text(rows: string[][], opts: { header?: boolean; delimiter?: string } = {}): string {
  const d = opts.delimiter ?? "\t";
  const header = opts.header === false ? "" : ["<DATE>", "<TIME>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>", "<TICKVOL>", "<VOL>", "<SPREAD>"].slice(0, rows[0]?.length ?? 9).join(d) + "\n";
  return header + rows.map((r) => r.join(d)).join("\n") + "\n";
}

/**
 * Deterministic synthetic EURUSD-like M1 export: Monday–Friday bars (broker
 * week Mon 00:00 → Fri 23:59), a pseudo-random walk from 1.07843.
 */
export function syntheticMt5Export(opts: { startDay: string; days: number; digits?: number; basePrice?: number; seed?: number }): { text: string; bars: number } {
  const digits = opts.digits ?? 5;
  const scale = 10 ** digits;
  let seed = opts.seed ?? 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let price = Math.round((opts.basePrice ?? 1.07843) * scale);
  const lines: string[] = ["<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>"];
  const start = wc(`${opts.startDay}T00:00`);
  let count = 0;
  for (let d = 0; d < opts.days; d += 1) {
    const dayStart = start + d * 1440;
    const weekday = new Date(dayStart * 60_000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let m = 0; m < 1440; m += 1) {
      const o = price;
      const c = Math.max(1, o + Math.round((rand() - 0.5) * 20));
      const h = Math.max(o, c) + Math.round(rand() * 8);
      const l = Math.max(1, Math.min(o, c) - Math.round(rand() * 8));
      price = c;
      const t = new Date((dayStart + m) * 60_000);
      const p = (n: number) => String(n).padStart(2, "0");
      const date = `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())}`;
      const time = `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`;
      const f = (x: number) => (x / scale).toFixed(digits);
      lines.push(`${date}\t${time}\t${f(o)}\t${f(h)}\t${f(l)}\t${f(c)}\t${1 + Math.floor(rand() * 60)}\t0\t${Math.floor(rand() * 12)}`);
      count += 1;
    }
  }
  return { text: lines.join("\n") + "\n", bars: count };
}
