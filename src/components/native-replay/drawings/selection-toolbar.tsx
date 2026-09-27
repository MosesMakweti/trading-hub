"use client";

import { Copy, Eye, Lock, LockOpen, Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computePosition } from "@/domain/native-replay/drawings/geometry";
import { DRAWING_COLORS, MAX_TARGETS, TOOLS, type ChartDrawing, type LineDash } from "@/domain/native-replay/drawings/model";

/**
 * Floating toolbar for the selected drawing: restrained styling (colour, width,
 * line style, opacity), text, lock/hide/duplicate/delete, and — for positions —
 * targets, the R:R readout and "Use in Trade Idea".
 */
export function SelectionToolbar({
  drawing,
  priceScale,
  pipSize,
  readOnly,
  onChange,
  onToggleLock,
  onHide,
  onDuplicate,
  onDelete,
  onUseInTradeIdea,
}: {
  drawing: ChartDrawing;
  priceScale: number;
  pipSize: number | null;
  readOnly: boolean;
  onChange: (mutate: (d: ChartDrawing) => void) => void;
  onToggleLock: () => void;
  onHide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUseInTradeIdea: () => void;
}) {
  const disabled = readOnly || drawing.locked;
  const isPosition = drawing.type === "LONG" || drawing.type === "SHORT";
  const pos = drawing.data.position;
  const calc = isPosition && pos ? computePosition(drawing.type as "LONG" | "SHORT", pos, priceScale, pipSize) : null;
  const s = 10 ** priceScale;
  const round = (x: number) => Math.round(x * s) / s;

  return (
    <div role="toolbar" aria-label={`${TOOLS[drawing.type].label} options`} className="absolute left-1/2 top-9 z-30 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 px-1.5 py-1 text-xs shadow-sm backdrop-blur-sm">
      <span className="px-1 font-medium">{TOOLS[drawing.type].label}</span>
      {!isPosition && (
        <>
          <div role="group" aria-label="Colour" className="flex items-center gap-0.5">
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={drawing.style.color === c}
                disabled={disabled}
                onClick={() => onChange((d) => void (d.style.color = c))}
                className={cn("size-4 rounded-full border disabled:opacity-40", drawing.style.color === c ? "border-foreground" : "border-transparent")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <label className="sr-only" htmlFor="nr-draw-width">Line width</label>
          <select id="nr-draw-width" disabled={disabled} value={drawing.style.width} onChange={(e) => onChange((d) => void (d.style.width = Number(e.target.value) as 1 | 2 | 3 | 4))} className="h-6 rounded border border-border bg-background px-1">
            {[1, 2, 3, 4].map((w) => (
              <option key={w} value={w}>{w}px</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="nr-draw-dash">Line style</label>
          <select id="nr-draw-dash" disabled={disabled} value={drawing.style.dash} onChange={(e) => onChange((d) => void (d.style.dash = e.target.value as LineDash))} className="h-6 rounded border border-border bg-background px-1">
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
          <label className="sr-only" htmlFor="nr-draw-opacity">Opacity</label>
          <select id="nr-draw-opacity" disabled={disabled} value={drawing.style.opacity} onChange={(e) => onChange((d) => void (d.style.opacity = Number(e.target.value)))} className="h-6 rounded border border-border bg-background px-1">
            {[1, 0.7, 0.4].map((o) => (
              <option key={o} value={o}>{Math.round(o * 100)}%</option>
            ))}
          </select>
        </>
      )}
      {drawing.type === "TEXT" && (
        <input
          aria-label="Note text"
          disabled={disabled}
          defaultValue={drawing.data.text ?? ""}
          maxLength={280}
          onBlur={(e) => e.target.value !== (drawing.data.text ?? "") && onChange((d) => void (d.data.text = e.target.value || "Note"))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-6 w-40 rounded border border-border bg-background px-1.5"
        />
      )}
      {calc && pos && (
        <>
          <span className={cn("px-1 tabular-nums", calc.valid ? "text-muted-foreground" : "text-red-400")}>
            {calc.valid ? `Risk ${calc.risk.toFixed(priceScale)} · ${calc.targets.map((t, i) => `TP${i + 1} ${t.rr}R`).join(" · ")}` : calc.issues[0]}
          </span>
          <Button type="button" size="xs" variant="ghost" disabled={disabled || pos.targets.length >= MAX_TARGETS} onClick={() => onChange((d) => {
            const p = d.data.position!;
            const last = p.targets[p.targets.length - 1];
            const step = last - p.entry;
            p.targets.push(round(last + step / Math.max(1, p.targets.length)));
          })} aria-label="Add target">
            <Plus /> Target
          </Button>
          {pos.targets.length > 1 && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange((d) => void d.data.position!.targets.pop())} aria-label="Remove last target">
              <Minus />
            </Button>
          )}
          <Button type="button" size="xs" disabled={readOnly || !calc.valid} onClick={onUseInTradeIdea} title="Pre-fill the Backtesting Trade Idea form with this position">
            Use in Trade Idea
          </Button>
        </>
      )}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <Button type="button" size="icon-xs" variant="ghost" disabled={readOnly} onClick={onToggleLock} aria-label={drawing.locked ? "Unlock drawing" : "Lock drawing"} aria-pressed={drawing.locked} title={drawing.locked ? "Unlock" : "Lock"}>
        {drawing.locked ? <Lock /> : <LockOpen />}
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={readOnly} onClick={onHide} aria-label="Hide drawing" title="Hide (restore from the Drawings list)">
        <Eye />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={readOnly} onClick={onDuplicate} aria-label="Duplicate drawing" title="Duplicate (Ctrl/⌘+D)">
        <Copy />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} onClick={onDelete} aria-label="Delete drawing" title="Delete (Del)">
        <Trash2 />
      </Button>
    </div>
  );
}
