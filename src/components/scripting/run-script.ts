"use client";

import type { RunOptions, RunResult, ScriptBar } from "@/domain/scripting/runtime";

export interface ScriptError {
  kind: "syntax" | "runtime" | "internal" | "timeout";
  message: string;
  line: number | null;
  col: number | null;
}

export type ScriptOutcome = { ok: true; result: RunResult } | { ok: false; error: ScriptError };

const TIMEOUT_MS = 8_000;

/**
 * Runs a script in a fresh Web Worker (sandbox) and terminates it when done or
 * after TIMEOUT_MS — a runaway script can never freeze the page.
 */
export function runScriptInWorker(source: string, bars: ScriptBar[], options: RunOptions = {}): Promise<ScriptOutcome> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./script.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: { kind: "timeout", message: `The script took longer than ${TIMEOUT_MS / 1000}s and was stopped.`, line: null, col: null } });
    }, TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<ScriptOutcome & { id: number }>) => {
      clearTimeout(timer);
      worker.terminate();
      const { id: _id, ...outcome } = ev.data;
      void _id;
      resolve(outcome as ScriptOutcome);
    };
    worker.onerror = (ev) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: { kind: "internal", message: ev.message || "The script sandbox failed.", line: null, col: null } });
    };
    worker.postMessage({ id: 1, source, bars, options });
  });
}
