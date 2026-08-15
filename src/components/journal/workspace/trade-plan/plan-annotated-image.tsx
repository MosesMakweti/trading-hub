"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface PlanImageLine {
  id: string;
  label: string;
  color: string;
  /** Normalized 0–1 vertical position within the image — the ONLY thing
   *  dragging changes. The price itself lives in the form beside this
   *  component and is never derived from y (spec §7: a line's pixel
   *  position is visual support, never the source of the confirmed price). */
  y: number;
  active?: boolean;
}

/**
 * The screenshot with horizontal plan lines overlaid. Click-and-drag a line
 * to reposition it vertically; the corresponding price still has to be typed
 * in the form — this is a visual aid, not a calibrated price scale (spec §7:
 * "the exact manually confirmed price must be the source of calculation").
 * Zoom/pan and non-horizontal (point-to-point) annotations are not in this
 * pass — see the completion report's "next checkpoint" list.
 */
export function PlanAnnotatedImage({
  imageUrl,
  alt,
  lines,
  editable,
  onLineDrag,
  onLineDragEnd,
  onImageClick,
}: {
  imageUrl: string;
  alt: string;
  lines: PlanImageLine[];
  editable: boolean;
  onLineDrag?: (id: string, y: number) => void;
  /** Fired once when a drag ends — the moment to persist, rather than on
   *  every pointermove. */
  onLineDragEnd?: (id: string) => void;
  /** Click anywhere on the image (not on a line) — used to place the
   *  currently-active line at that Y, a faster alternative to dragging. */
  onImageClick?: (y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function yFromPointer(clientY: number): number {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingId) return;
    onLineDrag?.(draggingId, yFromPointer(e.clientY));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (draggingId && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (draggingId) onLineDragEnd?.(draggingId);
    setDraggingId(null);
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full touch-none overflow-hidden rounded-xl border border-border bg-black/40 select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => {
        if (!editable || !onImageClick || draggingId) return;
        onImageClick(yFromPointer(e.clientY));
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} className="block w-full" draggable={false} />

      {lines.map((line) => (
        <div
          key={line.id}
          className={cn("absolute inset-x-0 flex items-center", editable && "cursor-ns-resize")}
          style={{ top: `${line.y * 100}%`, transform: "translateY(-50%)" }}
          onPointerDown={(e) => {
            if (!editable) return;
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDraggingId(line.id);
          }}
        >
          <div
            className={cn("h-px flex-1", line.active && "shadow-[0_0_0_1px_rgba(255,255,255,0.3)]")}
            style={{ backgroundColor: line.color }}
          />
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
            style={{ backgroundColor: line.color }}
          >
            {line.label}
          </span>
        </div>
      ))}
    </div>
  );
}
