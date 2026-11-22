/// <reference lib="webworker" />
/**
 * Sandbox for Traditorium Script. Runs the AST interpreter in a dedicated
 * Web Worker: no DOM, no cookies, no app state, no network calls made by the
 * script (the language has no I/O). The page terminates the worker on timeout.
 */
import { ScriptSyntaxError } from "@/domain/scripting/lexer";
import { run, ScriptRuntimeError, type RunOptions, type ScriptBar } from "@/domain/scripting/runtime";

export interface WorkerRequest {
  id: number;
  source: string;
  bars: ScriptBar[];
  options: RunOptions;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, source, bars, options } = ev.data;
  try {
    const result = run(source, bars, options);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (e) {
    const error =
      e instanceof ScriptSyntaxError
        ? { kind: "syntax", message: e.message, line: e.line, col: e.col }
        : e instanceof ScriptRuntimeError
          ? { kind: "runtime", message: e.message, line: e.line, col: null }
          : { kind: "internal", message: e instanceof Error ? e.message : "Script failed.", line: null, col: null };
    (self as unknown as Worker).postMessage({ id, ok: false, error });
  }
};
