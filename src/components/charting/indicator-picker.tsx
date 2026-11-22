"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Code2, Plus, Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INDICATORS, defaultInputs, type IndicatorDef } from "@/domain/indicators/catalog";
import { newUid, type ChartStudy } from "@/domain/charting/workspace";
import { listScriptsAction } from "@/actions/charting.actions";
import type { ScriptSummary } from "@/server/services/charting/charting.service";

const MAX_STUDIES = 12;

/** Searchable catalogue of built-in indicators and the trader's own scripts. */
export function IndicatorPicker({ open, onOpenChange, count, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; onAdd: (study: ChartStudy) => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"builtin" | "scripts">("builtin");
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);

  useEffect(() => {
    if (!open || tab !== "scripts") return;
    void listScriptsAction().then((r) => setScripts(r.success ? r.scripts : []));
  }, [open, tab]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = INDICATORS.filter((d) => !needle || d.name.toLowerCase().includes(needle) || d.description.toLowerCase().includes(needle) || d.id.includes(needle));
    const by = new Map<string, IndicatorDef[]>();
    for (const d of list) by.set(d.category, [...(by.get(d.category) ?? []), d]);
    return [...by.entries()];
  }, [q]);

  const full = count >= MAX_STUDIES;
  const add = (s: ChartStudy) => {
    onAdd(s);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Indicators & scripts</DialogTitle>
          <DialogDescription>
            Calculated in your browser from the candles already revealed on this chart — never from future bars. {full && <span className="text-amber-500">This chart has the maximum of {MAX_STUDIES} studies.</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div role="tablist" className="flex rounded-md border border-border text-xs">
            {(["builtin", "scripts"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cn("h-7 px-2.5 first:rounded-l-md last:rounded-r-md", tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {t === "builtin" ? "Built-in" : "My scripts"}
              </button>
            ))}
          </div>
          {tab === "builtin" && (
            <label className="relative flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search indicators" className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" aria-label="Search indicators" />
            </label>
          )}
        </div>
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {tab === "builtin" ? (
            groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No indicator matches “{q}”.</p>
            ) : (
              groups.map(([cat, defs]) => (
                <section key={cat} className="mb-3">
                  <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{cat}</h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {defs.map((d) => (
                      <li key={d.id}>
                        <button type="button" disabled={full} onClick={() => add({ uid: newUid(), kind: "indicator", id: d.id, inputs: defaultInputs(d), visible: true })} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted disabled:opacity-50">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{d.name}</span>
                            <span className="block text-xs text-muted-foreground">{d.description}</span>
                          </span>
                          <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{d.overlay ? "on price" : "own pane"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )
          ) : scripts === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : scripts.length === 0 ? (
            <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
              <p>You haven&apos;t written any scripts yet.</p>
              <Link href="/backtesting/scripts" className="inline-flex items-center gap-1 text-foreground underline underline-offset-4">
                <Code2 className="size-4" /> Open the script editor
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {scripts.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.kind === "strategy" ? "Strategy — on a chart it shows its plots; run it in the Strategy Tester for results" : "Indicator"} · v{s.version}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={full} onClick={() => add({ uid: newUid(), kind: "script", scriptId: s.id, inputs: {}, visible: true })}>
                    <Plus /> Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
