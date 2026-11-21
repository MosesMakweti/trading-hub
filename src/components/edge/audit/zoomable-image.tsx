"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ANNOTATION_KIND_LABEL } from "@/domain/trade-audit/labels";
import type { AnnotationMarker } from "@/types/trade-audit";

const MIN = 1;
const MAX = 6;

/**
 * An image that fills its box with its aspect ratio preserved (object-contain,
 * never stretched), with zoom (wheel, buttons, double-click), drag-to-pan once
 * zoomed, and reset. Review markers ride along inside the transformed layer
 * so they stay pinned to the chart at any zoom. A plain click (no drag) calls
 * `onExpand` — used to open the full-screen inspector.
 *
 * Remount it (key) to reset zoom when the image changes.
 */
export function ZoomableImage({
  src,
  alt,
  markers,
  onExpand,
  className,
}: {
  src: string;
  alt: string;
  markers?: AnnotationMarker[] | null;
  onExpand?: () => void;
  className?: string;
}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  function zoomTo(next: number, anchor?: { x: number; y: number }) {
    const s = Math.min(MAX, Math.max(MIN, next));
    if (s === MIN) {
      setScale(MIN);
      setPan({ x: 0, y: 0 });
      return;
    }
    // Keep the point under the cursor fixed while zooming.
    const a = anchor ?? { x: 0, y: 0 };
    setPan((p) => ({ x: a.x - ((a.x - p.x) * s) / scale, y: a.y - ((a.y - p.y) * s) / scale }));
    setScale(s);
  }

  function anchorOf(clientX: number, clientY: number) {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 } : { x: 0, y: 0 };
  }

  // Wheel zoom needs a NON-passive native listener (React's onWheel is
  // passive, so it can't stop the page from scrolling while zooming).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), anchorOf(e.clientX, e.clientY));
    };
  });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Fit the picture inside the box (contain) in explicit pixels, so the
  // marker layer covers exactly the drawn image — never the letterbox — and
  // the aspect ratio is always preserved.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitted =
    natural && box && box.w > 0 && box.h > 0
      ? (() => {
          const k = Math.min(box.w / natural.w, box.h / natural.h);
          return { width: natural.w * k, height: natural.h * k };
        })()
      : null;

  return (
    <div className={cn("group/zoom relative h-full w-full overflow-hidden bg-neutral-950", className)}>
      <div
        ref={boxRef}
        className={cn("absolute inset-0 flex items-center justify-center select-none", scale > 1 ? "cursor-grab active:cursor-grabbing" : onExpand && "cursor-zoom-in")}
        onDoubleClick={(e) => zoomTo(scale > 1 ? 1 : 2.5, anchorOf(e.clientX, e.clientY))}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (scale > 1) setPan({ x: d.px + dx, y: d.py + dy });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (d && !d.moved && scale === 1) onExpand?.();
        }}
      >
        <div
          className={cn("relative", !fitted && "h-full w-full")}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 80ms ease-out",
            ...(fitted ?? {}),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped media route */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
            className="block h-full w-full object-contain"
          />
          {fitted && (markers ?? []).map((m) => {
            const k = ANNOTATION_KIND_LABEL[m.kind];
            return (
              <span
                key={m.id}
                title={`${k.label}${m.note ? ` — ${m.note}` : ""} (added in review)`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, backgroundColor: k.color, transform: `translate(-50%, -50%) scale(${1 / scale})` }}
              >
                {k.short}
              </span>
            );
          })}
        </div>
      </div>

      <div className="absolute right-2 bottom-2 flex items-center gap-1 rounded-lg bg-black/60 p-1 text-white opacity-80 backdrop-blur transition-opacity group-hover/zoom:opacity-100">
        <Button type="button" variant="ghost" size="icon-xs" className="text-white hover:bg-white/15 hover:text-white" aria-label="Zoom out" onClick={() => zoomTo(scale / 1.5)} disabled={scale <= MIN}>
          <ZoomOut />
        </Button>
        <span className="w-9 text-center text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
        <Button type="button" variant="ghost" size="icon-xs" className="text-white hover:bg-white/15 hover:text-white" aria-label="Zoom in" onClick={() => zoomTo(scale * 1.5)} disabled={scale >= MAX}>
          <ZoomIn />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="text-white hover:bg-white/15 hover:text-white" aria-label="Reset zoom" onClick={() => zoomTo(1)} disabled={scale === 1}>
          <RotateCcw />
        </Button>
        {onExpand && (
          <Button type="button" variant="ghost" size="icon-xs" className="text-white hover:bg-white/15 hover:text-white" aria-label="Inspect full screen" onClick={onExpand}>
            <Maximize2 />
          </Button>
        )}
      </div>
    </div>
  );
}
