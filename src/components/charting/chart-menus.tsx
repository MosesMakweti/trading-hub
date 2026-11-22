"use client";

import { useState } from "react";
import { CandlestickChart, Columns2, Grid2x2, LayoutPanelLeft, Maximize2, Rows2, Save, Settings, Square, Trash2 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CHART_TYPES, type ChartTypeKey } from "@/domain/indicators/chart-types";
import { BUILTIN_PRESETS, CHART_LAYOUTS, type ChartLayoutKey, type ChartSettings, type Workspace, type WorkspacePreset } from "@/domain/charting/workspace";

const triggerCls = "inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
    </label>
  );
}

export function ChartTypeMenu({ value, param, onChange }: { value: ChartTypeKey; param: number | null; onChange: (type: ChartTypeKey, param: number | null) => void }) {
  const current = CHART_TYPES.find((t) => t.key === value)!;
  const [draft, setDraft] = useState(param == null ? "" : String(param));
  return (
    <Popover>
      <PopoverTrigger className={triggerCls} aria-label={`Chart type: ${current.label}`}>
        <CandlestickChart className="size-3.5" /> <span className="max-sm:hidden">{current.label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <ul role="listbox" aria-label="Chart type">
          {CHART_TYPES.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                role="option"
                aria-selected={t.key === value}
                onClick={() => {
                  onChange(t.key, null);
                  setDraft("");
                }}
                className={cn("flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted", t.key === value && "bg-muted font-medium")}
              >
                {t.label}
                {t.synthetic && <span className="text-[10px] uppercase text-muted-foreground">calculated</span>}
              </button>
            </li>
          ))}
        </ul>
        {current.param && (
          <form
            className="mt-1.5 flex items-center gap-2 border-t border-border px-2 pt-2 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(draft);
              onChange(value, draft.trim() === "" || !(n > 0) ? null : current.param!.kind === "count" ? Math.max(1, Math.round(n)) : n);
            }}
          >
            <span className="text-muted-foreground">{current.param.label}</span>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={current.param.default === "auto" ? "auto" : String(current.param.default)} inputMode="decimal" className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 tabular-nums" aria-label={current.param.label} />
            <button type="submit" className="rounded-md border border-border px-2 py-1 hover:bg-muted">Set</button>
          </form>
        )}
        {current.synthetic && <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">Calculated from market candles; not tradable prices. Order entry still uses market prices.</p>}
      </PopoverContent>
    </Popover>
  );
}

export function ChartSettingsMenu({ settings, onChange }: { settings: ChartSettings; onChange: (s: ChartSettings) => void }) {
  const set = <K extends keyof ChartSettings>(k: K, v: ChartSettings[K]) => onChange({ ...settings, [k]: v });
  return (
    <Popover>
      <PopoverTrigger className={triggerCls} aria-label="Chart settings">
        <Settings className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Chart settings</p>
        <Toggle label="Grid lines" checked={settings.grid} onChange={(v) => set("grid", v)} />
        <Toggle label="Legend" checked={settings.showLegend} onChange={(v) => set("showLegend", v)} />
        <Toggle label="Last price line" checked={settings.showLastPrice} onChange={(v) => set("showLastPrice", v)} />
        <Toggle label="Tick volume pane" checked={settings.showVolume} onChange={(v) => set("showVolume", v)} />
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Crosshair</span>
          <select value={settings.crosshair} onChange={(e) => set("crosshair", e.target.value as ChartSettings["crosshair"])} className="h-7 rounded-md border border-border bg-background px-1 text-xs">
            <option value="normal">Free</option>
            <option value="magnet">Magnet</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Price scale</span>
          <select value={settings.priceScale} onChange={(e) => set("priceScale", e.target.value as ChartSettings["priceScale"])} className="h-7 rounded-md border border-border bg-background px-1 text-xs">
            <option value="normal">Regular</option>
            <option value="log">Logarithmic</option>
            <option value="percent">Percent</option>
            <option value="indexed">Indexed to 100</option>
          </select>
        </label>
        <div className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Candle colours</span>
          <span className="flex items-center gap-1.5">
            <input type="color" aria-label="Up colour" value={settings.upColor ?? "#4f9d86"} onChange={(e) => set("upColor", e.target.value)} className="size-6 cursor-pointer rounded border border-border bg-transparent" />
            <input type="color" aria-label="Down colour" value={settings.downColor ?? "#c4655f"} onChange={(e) => set("downColor", e.target.value)} className="size-6 cursor-pointer rounded border border-border bg-transparent" />
            {(settings.upColor || settings.downColor) && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange({ ...settings, upColor: null, downColor: null })}>Reset</button>
            )}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const LAYOUT_ICON: Record<ChartLayoutKey, typeof Square> = { "1": Square, "2h": Columns2, "2v": Rows2, "3": LayoutPanelLeft, "4": Grid2x2 };

export function LayoutMenu({ ws, onLayout, onSync, onPanels, onFocus, onApplyPreset, onSavePreset, onDeletePreset }: {
  ws: Workspace;
  onLayout: (l: ChartLayoutKey) => void;
  onSync: (k: keyof Workspace["sync"], v: boolean) => void;
  onPanels: (p: Workspace["panels"]) => void;
  onFocus: () => void;
  onApplyPreset: (p: WorkspacePreset) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const Icon = LAYOUT_ICON[ws.layout];
  return (
    <Popover>
      <PopoverTrigger className={triggerCls} aria-label="Layout and panels">
        <Icon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <section>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Charts</p>
          <div className="flex gap-1" role="radiogroup" aria-label="Chart layout">
            {CHART_LAYOUTS.map((l) => {
              const I = LAYOUT_ICON[l.key];
              return (
                <button key={l.key} type="button" role="radio" aria-checked={ws.layout === l.key} title={l.label} aria-label={l.label} onClick={() => onLayout(l.key)} className={cn("grid size-8 place-items-center rounded-md border", ws.layout === l.key ? "border-foreground bg-muted" : "border-border hover:bg-muted")}>
                  <I className="size-4" />
                </button>
              );
            })}
          </div>
          {ws.layout !== "1" && (
            <div className="mt-2 grid grid-cols-2 gap-x-3">
              <Toggle label="Sync symbol" checked={ws.sync.symbol} onChange={(v) => onSync("symbol", v)} />
              <Toggle label="Sync interval" checked={ws.sync.timeframe} onChange={(v) => onSync("timeframe", v)} />
              <Toggle label="Sync crosshair" checked={ws.sync.crosshair} onChange={(v) => onSync("crosshair", v)} />
              <Toggle label="Sync time" checked={ws.sync.time} onChange={(v) => onSync("time", v)} />
            </div>
          )}
        </section>
        <section>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Panels</p>
          <Toggle label="Drawing tools (left)" checked={ws.panels.left.visible} onChange={(v) => onPanels({ ...ws.panels, left: { visible: v } })} />
          <Toggle label="Order panel (right)" checked={ws.panels.right.visible} onChange={(v) => onPanels({ ...ws.panels, right: { ...ws.panels.right, visible: v } })} />
          <Toggle label="Positions & tester (bottom)" checked={ws.panels.bottom.visible} onChange={(v) => onPanels({ ...ws.panels, bottom: { ...ws.panels.bottom, visible: v } })} />
          <button type="button" onClick={onFocus} className="mt-1 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline">
            <Maximize2 className="size-3.5" /> Focus mode <kbd className="rounded border border-border px-1 font-mono text-[10px]">Shift F</kbd>
          </button>
        </section>
        <section>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Presets</p>
          <ul className="space-y-0.5">
            {[...BUILTIN_PRESETS.map((p) => ({ p, builtin: true })), ...ws.presets.map((p) => ({ p, builtin: false }))].map(({ p, builtin }) => (
              <li key={`${builtin}-${p.name}`} className="flex items-center gap-1">
                <button type="button" onClick={() => onApplyPreset(p)} className="flex-1 rounded px-1.5 py-0.5 text-left text-sm hover:bg-muted">
                  {p.name} {builtin && <span className="text-[10px] text-muted-foreground">built-in</span>}
                </button>
                {!builtin && (
                  <button type="button" onClick={() => onDeletePreset(p.name)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Delete preset ${p.name}`}>
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onSavePreset(name.trim());
              setName("");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Save current as…" className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs" aria-label="Preset name" />
            <button type="submit" disabled={!name.trim() || ws.presets.length >= 12} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted disabled:opacity-50">
              <Save className="size-3" /> Save
            </button>
          </form>
        </section>
      </PopoverContent>
    </Popover>
  );
}
