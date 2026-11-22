"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Drag (or arrow-key) handle that resizes an adjacent panel. `direction`
 * says which way growing goes: "left" = the panel is to the right of the
 * handle (dragging left grows it), "up" = the panel is below the handle.
 */
export function ResizeHandle({ direction, value, min, max, onChange, onCommit, label }: { direction: "left" | "up"; value: number; min: number; max: number; onChange: (v: number) => void; onCommit: (v: number) => void; label: string }) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const last = useRef(value);
  const horizontal = direction === "left";
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={cn("group relative z-30 shrink-0 touch-none bg-border outline-none focus-visible:bg-primary", horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: horizontal ? e.clientX : e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = start.current.pos - (horizontal ? e.clientX : e.clientY);
        last.current = clamp(start.current.value + delta);
        onChange(last.current);
      }}
      onPointerUp={() => {
        if (start.current) onCommit(last.current);
        start.current = null;
      }}
      onKeyDown={(e) => {
        const grow = horizontal ? e.key === "ArrowLeft" : e.key === "ArrowUp";
        const shrink = horizontal ? e.key === "ArrowRight" : e.key === "ArrowDown";
        if (!grow && !shrink) return;
        e.preventDefault();
        const v = clamp(value + (grow ? 16 : -16));
        onChange(v);
        onCommit(v);
      }}
    >
      <span className={cn("absolute group-hover:bg-primary/40", horizontal ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1")} />
    </div>
  );
}
