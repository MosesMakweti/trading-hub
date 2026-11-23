"use client";

/**
 * Replay performance instrumentation (always on, negligible cost).
 *
 * Records, per replay step: click → server response (network + server),
 * the server's own time, and response → charts updated; plus individual
 * chart update timings. Inspect in the browser console:
 *
 *   __replayPerf.summary()   // medians / p90 of the last 200 steps
 *   __replayPerf.steps       // raw step records
 *
 * Nothing is sent anywhere.
 */

export interface StepRecord {
  command: string;
  /** Click → step response received (network + server). */
  responseMs: number;
  /** Server-side time reported by the action. */
  serverMs: number | null;
  /** Response → every chart updated (client work). */
  applyMs: number | null;
  /** Click → charts updated. */
  totalMs: number | null;
  /** Patch (no trading change) or full state. */
  kind: "patch" | "full";
  revealedBars: number;
}

interface Store {
  steps: StepRecord[];
  events: { label: string; ms: number; detail?: string }[];
  summary: () => Record<string, { median: number; p90: number; n: number }>;
}

const MAX = 200;

function store(): Store | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __replayPerf?: Store };
  if (!w.__replayPerf) {
    const s: Store = {
      steps: [],
      events: [],
      summary() {
        const stat = (vals: number[]) => {
          const v = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
          return { median: v.length ? +v[Math.floor(v.length / 2)].toFixed(1) : NaN, p90: v.length ? +v[Math.floor(v.length * 0.9)].toFixed(1) : NaN, n: v.length };
        };
        const out: Record<string, { median: number; p90: number; n: number }> = {
          "click → response": stat(s.steps.map((x) => x.responseMs)),
          "server": stat(s.steps.map((x) => x.serverMs ?? NaN)),
          "response → charts": stat(s.steps.map((x) => x.applyMs ?? NaN)),
          "click → charts": stat(s.steps.map((x) => x.totalMs ?? NaN)),
        };
        for (const label of new Set(s.events.map((e) => e.label))) out[label] = stat(s.events.filter((e) => e.label === label).map((e) => e.ms));
        return out;
      },
    };
    w.__replayPerf = s;
  }
  return w.__replayPerf;
}

export function noteStep(r: StepRecord): void {
  const s = store();
  if (!s) return;
  s.steps.push(r);
  if (s.steps.length > MAX) s.steps.shift();
}

export function notePerf(label: string, ms: number, detail?: string): void {
  const s = store();
  if (!s) return;
  s.events.push({ label, ms, detail });
  if (s.events.length > MAX * 4) s.events.shift();
}
