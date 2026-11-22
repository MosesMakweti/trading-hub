"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, Copy, History, Loader2, Play, Plus, Save, Search, SquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScriptSyntaxError } from "@/domain/scripting/lexer";
import { parse } from "@/domain/scripting/parser";
import { SCRIPT_TEMPLATES } from "@/domain/scripting/builtins";
import type { RunResult, ScriptBar } from "@/domain/scripting/runtime";
import {
  archiveScriptAction,
  createScriptAction,
  duplicateScriptAction,
  getScriptAction,
  getScriptVersionAction,
  listScriptsAction,
  renameScriptAction,
  restoreScriptVersionAction,
  saveScriptAction,
} from "@/actions/charting.actions";
import type { ScriptDetail, ScriptSummary } from "@/server/services/charting/charting.service";
import { runScriptInWorker, type ScriptError } from "./run-script";
import { ScriptCodeEditor, type EditorDiagnostic } from "./script-code-editor";
import { StrategyReportView } from "./strategy-report";

export interface TestData {
  bars: ScriptBar[];
  lastForming: boolean;
  priceDigits: number;
  label: string;
  /** From the account's instrument specs (null = unknown → 1). */
  pointValue: { pointValue: number; currency: string; quantityUnit: string } | null;
}

interface Props {
  /** Candles to run on (the terminal's active chart). Absent → syntax check only. */
  loadTestData?: () => Promise<TestData | null>;
  onAddToChart?: (script: ScriptSummary) => void;
  onSaved?: (script: ScriptSummary) => void;
  className?: string;
}

type Output = { kind: "none" } | { kind: "running" } | { kind: "error"; error: ScriptError } | { kind: "ok"; result: RunResult; data: TestData; ms: number };

/**
 * Traditorium Script workbench: library, editor, console and Strategy
 * Tester. Scripts are stored as text on the server and only ever run in the
 * browser sandbox (Web Worker) on candles the account has revealed.
 */
export function ScriptWorkbench({ loadTestData, onAddToChart, onSaved, className }: Props) {
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);
  const [current, setCurrent] = useState<ScriptDetail | null>(null);
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [output, setOutput] = useState<Output>({ kind: "none" });
  const [syntax, setSyntax] = useState<EditorDiagnostic[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState<{ version: number; source: string } | null>(null);
  const dirty = !!current && source !== current.source;
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const refreshList = useCallback(async () => {
    const r = await listScriptsAction();
    if (r.success) setScripts(r.scripts);
  }, []);
  useEffect(() => {
    void listScriptsAction().then((r) => r.success && setScripts(r.scripts));
  }, []);

  const open = useCallback(async (id: string) => {
    if (dirtyRef.current && !confirm("Discard unsaved changes?")) return;
    const r = await getScriptAction({ id });
    if (!r.success) return void toast.error(r.error);
    setCurrent(r.script);
    setSource(r.script.source);
    setOutput({ kind: "none" });
    setPreview(null);
  }, []);

  // Syntax check as you type (parse only — nothing runs).
  useEffect(() => {
    const h = setTimeout(() => {
      try {
        if (source.trim()) parse(source);
        setSyntax([]);
      } catch (e) {
        if (e instanceof ScriptSyntaxError) setSyntax([{ line: e.line, col: e.col, message: e.message, severity: "error" }]);
        else setSyntax([{ line: 1, message: e instanceof Error ? e.message : "Couldn't read the script.", severity: "error" }]);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [source]);

  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    if (syntax.length) return syntax;
    if (output.kind === "error" && output.error.line) return [{ line: output.error.line, col: output.error.col, message: output.error.message, severity: "error" }];
    return [];
  }, [syntax, output]);

  const create = async (templateKey: string) => {
    if (dirtyRef.current && !confirm("Discard unsaved changes?")) return;
    const t = SCRIPT_TEMPLATES.find((x) => x.key === templateKey)!;
    const r = await createScriptAction({ name: `My ${t.label.toLowerCase()}`, source: t.source });
    if (!r.success) return void toast.error(r.error);
    await refreshList();
    dirtyRef.current = false;
    await open(r.script.id);
  };

  const save = useCallback(async () => {
    if (!current || saving) return;
    if (source === current.source) return;
    setSaving(true);
    const r = await saveScriptAction({ id: current.id, source, baseVersion: current.version });
    setSaving(false);
    if (!r.success) return void toast.error(r.error);
    const d = await getScriptAction({ id: current.id });
    if (d.success) setCurrent(d.script);
    toast.success(`Saved version ${r.script.version}`);
    void refreshList();
    onSaved?.(r.script);
  }, [current, saving, source, refreshList, onSaved]);

  const runIt = async () => {
    if (syntax.length) return toast.error("Fix the syntax error first.");
    if (!loadTestData) return toast.message("No syntax errors. Open a simulation terminal to run scripts on candles.");
    setOutput({ kind: "running" });
    const data = await loadTestData();
    if (!data) return setOutput({ kind: "none" });
    const t0 = performance.now();
    const out = await runScriptInWorker(source, data.bars, { lastBarForming: data.lastForming, pointValue: data.pointValue?.pointValue });
    setOutput(out.ok ? { kind: "ok", result: out.result, data, ms: performance.now() - t0 } : { kind: "error", error: out.error });
  };

  const filtered = (scripts ?? []).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {/* Library */}
      <aside aria-label="Your scripts" className="flex w-56 shrink-0 flex-col border-r border-border max-md:hidden">
        <div className="flex items-center gap-1 border-b border-border p-1.5">
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search scripts" className="h-7 w-full rounded-md border border-border bg-background pl-6 pr-1 text-xs" />
          </label>
          <NewMenu onPick={(k) => void create(k)} />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {scripts === null ? (
            <li className="p-2 text-xs text-muted-foreground">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="p-2 text-xs text-muted-foreground">{scripts.length ? "No match." : "No scripts yet — start from a template (+)."}</li>
          ) : (
            filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => void open(s.id)} aria-current={current?.id === s.id ? "true" : undefined} className={cn("w-full rounded px-2 py-1 text-left hover:bg-muted", current?.id === s.id && "bg-muted")}>
                  <span className="block truncate text-xs font-medium">{s.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{s.kind} · v{s.version}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Editor */}
      <section aria-label="Script editor" className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border p-1.5 md:hidden">
          <select aria-label="Open a script" value={current?.id ?? ""} onChange={(e) => e.target.value && void open(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-sm">
            <option value="">{scripts?.length ? "Open a script…" : "No scripts yet"}</option>
            {(scripts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · v{s.version}</option>)}
          </select>
          <NewMenu onPick={(k) => void create(k)} />
        </div>
        {!current ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              <p className="text-sm font-medium">Traditorium Script</p>
              <p className="text-xs text-muted-foreground">Pine Script®-style syntax — a documented subset of v6. Scripts run in a sandbox in your browser on candles you have already replayed.</p>
              <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                {SCRIPT_TEMPLATES.map((t) => (
                  <Button key={t.key} size="sm" variant="outline" onClick={() => void create(t.key)}>
                    <Plus /> {t.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1">
              <input
                key={current.id}
                defaultValue={current.name}
                aria-label="Script name"
                maxLength={80}
                onBlur={async (e) => {
                  const name = e.target.value.trim();
                  if (!name || name === current.name) return;
                  const r = await renameScriptAction({ id: current.id, name });
                  if (!r.success) return void toast.error(r.error);
                  setCurrent({ ...current, name });
                  void refreshList();
                }}
                className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium hover:border-border focus:border-border"
              />
              <span className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">v{current.version}{dirty && " · edited"}</span>
              <Button size="sm" variant="ghost" onClick={() => void save()} disabled={!dirty || saving} title="Save a new version (Ctrl+S)">
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runIt()} disabled={output.kind === "running"} title={loadTestData ? "Run on the active chart's candles" : "Check syntax"}>
                {output.kind === "running" ? <Loader2 className="animate-spin" /> : <Play />} {loadTestData ? (current.kind === "strategy" ? "Run tester" : "Run") : "Check"}
              </Button>
              {onAddToChart && (
                <Button size="sm" variant="ghost" disabled={dirty} title={dirty ? "Save first" : "Add to the active chart"} onClick={() => onAddToChart(current)}>
                  <SquarePlus /> Add to chart
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" aria-label="Version history" aria-pressed={showHistory} onClick={() => setShowHistory((v) => !v)}>
                <History />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Duplicate"
                onClick={async () => {
                  const r = await duplicateScriptAction({ id: current.id });
                  if (!r.success) return void toast.error(r.error);
                  await refreshList();
                  await open(r.script.id);
                }}
              >
                <Copy />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Archive"
                onClick={async () => {
                  if (!confirm(`Archive “${current.name}”? Charts using it will show it as unavailable.`)) return;
                  const r = await archiveScriptAction({ id: current.id, archived: true });
                  if (!r.success) return void toast.error(r.error);
                  setCurrent(null);
                  setSource("");
                  void refreshList();
                }}
              >
                <Archive />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                <ScriptCodeEditor value={preview ? preview.source : source} onChange={preview ? () => {} : setSource} onSave={() => void save()} diagnostics={preview ? [] : diagnostics} readOnly={!!preview} />
              </div>
              {showHistory && (
                <aside aria-label="Version history" className="w-52 shrink-0 overflow-y-auto border-l border-border p-1.5">
                  <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Versions</p>
                  <ul className="space-y-0.5">
                    {current.versions.map((v) => (
                      <li key={v.version}>
                        <button
                          type="button"
                          onClick={async () => {
                            if (v.version === current.version) return setPreview(null);
                            const r = await getScriptVersionAction({ id: current.id, version: v.version });
                            if (r.success) setPreview({ version: v.version, source: r.source });
                          }}
                          className={cn("w-full rounded px-1.5 py-1 text-left text-xs hover:bg-muted", (preview?.version ?? current.version) === v.version && "bg-muted")}
                        >
                          <span className="font-mono">v{v.version}</span> <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                          {v.note && <span className="block truncate text-[10px] text-muted-foreground">{v.note}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {preview && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      <p className="px-1 text-[11px] text-muted-foreground">Viewing v{preview.version} (read-only).</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={async () => {
                          if (dirty && !confirm("Discard unsaved changes and restore this version?")) return;
                          const r = await restoreScriptVersionAction({ id: current.id, version: preview.version });
                          if (!r.success) return void toast.error(r.error);
                          const d = await getScriptAction({ id: current.id });
                          if (d.success) {
                            setCurrent(d.script);
                            setSource(d.script.source);
                          }
                          setPreview(null);
                          toast.success(`Restored as version ${r.script.version}`);
                          void refreshList();
                          onSaved?.(r.script);
                        }}
                      >
                        Restore as new version
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full" onClick={() => setPreview(null)}>Back to current</Button>
                    </div>
                  )}
                </aside>
              )}
            </div>
          </>
        )}
      </section>

      {/* Console / tester */}
      {current && (
        <section aria-label="Script output" aria-live="polite" className="flex w-[22rem] shrink-0 flex-col border-l border-border max-lg:hidden">
          <p className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{current.kind === "strategy" && loadTestData ? "Strategy Tester" : "Console"}</p>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
            {diagnostics.length > 0 && (
              <ul className="mb-2 space-y-1">
                {diagnostics.map((d, i) => (
                  <li key={i} className="rounded border border-red-400/40 bg-red-400/5 px-2 py-1 text-red-400">Line {d.line}{d.col ? `:${d.col}` : ""} — {d.message}</li>
                ))}
              </ul>
            )}
            {output.kind === "none" && !diagnostics.length && <p className="text-muted-foreground">{loadTestData ? "Run the script to see its output here." : "No syntax errors."}</p>}
            {output.kind === "running" && <p className="text-muted-foreground">Running in the sandbox…</p>}
            {output.kind === "error" && !output.error.line && <p className="rounded border border-red-400/40 bg-red-400/5 px-2 py-1 text-red-400">{output.error.message}</p>}
            {output.kind === "ok" && <RunOutput output={output} />}
          </div>
        </section>
      )}
    </div>
  );
}

function RunOutput({ output }: { output: Extract<Output, { kind: "ok" }> }) {
  const { result, data, ms } = output;
  const pv = data.pointValue;
  const money = pv
    ? `Money in ${pv.currency}: P&L = price move × quantity (${pv.quantityUnit}s) × ${pv.pointValue.toLocaleString()} per 1.0 move, from this account's instrument specs; no spread, swap or currency conversion.`
    : "This instrument's contract details are incomplete, so P&L = price move × quantity (point value 1).";
  const context = `${data.label} · ${data.bars.length.toLocaleString()} revealed candles · ${Math.round(ms)} ms in the browser sandbox.${result.kind === "strategy" ? ` A study result, not an account result. ${money}` : ""}`;
  return (
    <div className="space-y-3">
      {result.strategy ? (
        <StrategyReportView report={result.strategy} bars={data.bars} priceDigits={data.priceDigits} context={context} />
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">{context}</p>
          <p>
            {result.plots.length} plot{result.plots.length === 1 ? "" : "s"}, {result.shapes.length} shape{result.shapes.length === 1 ? "" : "s"}, {result.alerts.length} alert{result.alerts.length === 1 ? "" : "s"}. Add it to the chart to see it.
          </p>
        </>
      )}
      {result.logs.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Log</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
            {result.logs.slice(-200).map((l, i) => (
              <li key={i} className={cn(l.level === "error" ? "text-red-400" : l.level === "warning" ? "text-amber-500" : "")}>
                [{l.bar}] {l.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewMenu({ onPick }: { onPick: (key: string) => void }) {
  return (
    <select aria-label="New script from template" value="" onChange={(e) => e.target.value && onPick(e.target.value)} className="h-7 w-8 shrink-0 cursor-pointer appearance-none rounded-md border border-border bg-background text-center text-sm">
      <option value="">+</option>
      {SCRIPT_TEMPLATES.map((t) => (
        <option key={t.key} value={t.key}>New {t.label.toLowerCase()}</option>
      ))}
    </select>
  );
}
