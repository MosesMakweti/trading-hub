"use client";

import { Eye, EyeOff, Lock, LockOpen, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { TOOLS, type ChartDrawing } from "@/domain/native-replay/drawings/model";
import { TOOL_ICONS } from "./drawing-toolbar";

/** Compact list of the asset's drawings: select, show/hide, lock/unlock, delete. */
export function DrawingManager({
  drawings,
  selectedId,
  readOnly,
  onSelect,
  onToggleHidden,
  onToggleLock,
  onDelete,
  onClose,
}: {
  drawings: readonly ChartDrawing[];
  selectedId: string | null;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section aria-label="Drawings" className="absolute bottom-3 left-2 z-30 w-64 rounded-lg border border-border bg-card/95 text-xs shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="font-medium">Drawings ({drawings.length})</span>
        <button type="button" onClick={onClose} aria-label="Close drawings list" className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      {drawings.length === 0 ? (
        <p className="px-2 py-3 text-muted-foreground">No drawings on this asset yet.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {drawings.map((d) => {
            const Icon = TOOL_ICONS[d.type];
            return (
              <li key={d.id} className={cn("flex items-center gap-1.5 px-2 py-1", d.id === selectedId && "bg-muted/60")}>
                <button type="button" className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", d.hidden && "text-muted-foreground")} onClick={() => onSelect(d.id)} disabled={d.hidden}>
                  <Icon className="size-3.5 shrink-0" style={{ color: d.style.color }} />
                  <span className="truncate">{d.type === "TEXT" ? d.data.text || "Note" : TOOLS[d.type].label}</span>
                </button>
                <button type="button" disabled={readOnly} onClick={() => onToggleHidden(d.id)} aria-label={d.hidden ? "Show drawing" : "Hide drawing"} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                  {d.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
                <button type="button" disabled={readOnly} onClick={() => onToggleLock(d.id)} aria-label={d.locked ? "Unlock drawing" : "Lock drawing"} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                  {d.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                </button>
                <button type="button" disabled={readOnly || d.locked} onClick={() => onDelete(d.id)} aria-label="Delete drawing" className="text-muted-foreground hover:text-red-400 disabled:opacity-40">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
