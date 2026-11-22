"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { INDICATOR_BY_ID, defaultInputs, sanitizeInputs } from "@/domain/indicators/catalog";
import type { InputDescriptor } from "@/domain/scripting/runtime";
import type { ScriptState } from "@/domain/charting/render-model";
import type { ChartStudy } from "@/domain/charting/workspace";

const SOURCES = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"];

type Field = { key: string; label: string; kind: "number" | "source" | "bool" | "text" | "options"; value: number | string | boolean; min?: number; max?: number; step?: number; options?: string[] };

function fieldsFor(study: ChartStudy, script: ScriptState | null): Field[] | null {
  if (study.kind === "indicator") {
    const def = INDICATOR_BY_ID.get(study.id);
    if (!def) return [];
    const values = sanitizeInputs(def, study.inputs);
    return def.inputs.map((i) =>
      i.type === "source"
        ? { key: i.key, label: i.label, kind: "source", value: String(values[i.key]) }
        : { key: i.key, label: i.label, kind: "number", value: Number(values[i.key]), min: i.min, max: i.max, step: i.type === "float" ? i.step : 1 },
    );
  }
  if (!script || script.status !== "ok") return null;
  return script.result.inputs.map((d: InputDescriptor) => {
    const v = study.inputs[d.key] ?? d.default;
    if (d.options) return { key: d.key, label: d.key, kind: "options", value: String(v), options: d.options };
    if (d.type === "source") return { key: d.key, label: d.key, kind: "source", value: String(v) };
    if (d.type === "bool") return { key: d.key, label: d.key, kind: "bool", value: v === true };
    if (d.type === "int" || d.type === "float") return { key: d.key, label: d.key, kind: "number", value: Number(v), min: d.min, max: d.max, step: d.step ?? (d.type === "int" ? 1 : 0.1) };
    return { key: d.key, label: d.key, kind: "text", value: String(v ?? "") };
  });
}

/** Inputs of one study (built-in indicator or script). Values are clamped again when saved. */
export function StudySettings({ study, script, onClose, onSave }: { study: ChartStudy | null; script: ScriptState | null; onClose: () => void; onSave: (inputs: Record<string, number | string | boolean>) => void }) {
  return (
    <Dialog open={!!study} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">{study && <Body key={study.uid} study={study} script={script} onClose={onClose} onSave={onSave} />}</DialogContent>
    </Dialog>
  );
}

function Body({ study, script, onClose, onSave }: { study: ChartStudy; script: ScriptState | null; onClose: () => void; onSave: (inputs: Record<string, number | string | boolean>) => void }) {
  const fields = fieldsFor(study, script);
  const [values, setValues] = useState<Record<string, number | string | boolean>>(() => Object.fromEntries((fields ?? []).map((f) => [f.key, f.value])));
  const title = study.kind === "indicator" ? (INDICATOR_BY_ID.get(study.id)?.name ?? "Indicator") : script && script.status !== "running" ? script.name : "Script";
  const reset = () => {
    if (study.kind === "indicator") {
      const def = INDICATOR_BY_ID.get(study.id);
      if (def) setValues(defaultInputs(def));
    } else if (script?.status === "ok") setValues(Object.fromEntries(script.result.inputs.map((d) => [d.key, d.default as number | string | boolean])));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{fields === null ? "Inputs appear once the script has run without errors." : fields.length === 0 ? "This study has no inputs." : "Changes apply to this chart only."}</DialogDescription>
      </DialogHeader>
      <form
        id="study-settings"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(values);
        }}
      >
        {(fields ?? []).map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{f.label}</span>
            {f.kind === "number" ? (
              <input type="number" value={String(values[f.key])} min={f.min} max={f.max} step={f.step} onChange={(e) => setValues({ ...values, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8 w-28 rounded-md border border-border bg-background px-2 text-right tabular-nums" />
            ) : f.kind === "bool" ? (
              <input type="checkbox" checked={values[f.key] === true} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} className="size-4" />
            ) : f.kind === "text" ? (
              <input value={String(values[f.key])} maxLength={200} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="h-8 w-40 rounded-md border border-border bg-background px-2" />
            ) : (
              <select value={String(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="h-8 w-28 rounded-md border border-border bg-background px-1.5">
                {(f.kind === "options" ? f.options! : SOURCES).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </label>
        ))}
      </form>
      <DialogFooter>
        {(fields?.length ?? 0) > 0 && <Button variant="ghost" onClick={reset} className="mr-auto">Defaults</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="study-settings" disabled={!fields?.length}>Apply</Button>
      </DialogFooter>
    </>
  );
}
