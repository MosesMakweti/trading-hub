/**
 * Placement of the floating replay toolbar inside the chart area. Positions
 * are stored as fractions of the FREE space (area − toolbar), so the toolbar
 * stays in the same relative place when panels resize, and can never leave
 * the visible area.
 */
import type { ReplayBarSettings } from "@/domain/charting/workspace";

export interface Size {
  w: number;
  h: number;
}

export const DOCK_MARGIN = 8;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** Pixel position (left/top) of the toolbar within the area. */
export function barPosition(area: Size, bar: Size, s: Pick<ReplayBarSettings, "mode" | "x" | "y">): { left: number; top: number } {
  const freeW = Math.max(0, area.w - bar.w);
  const freeH = Math.max(0, area.h - bar.h);
  if (s.mode === "top") return { left: freeW / 2, top: Math.min(DOCK_MARGIN, freeH) };
  if (s.mode === "bottom") return { left: freeW / 2, top: Math.max(0, freeH - DOCK_MARGIN) };
  return { left: clamp01(s.x) * freeW, top: clamp01(s.y) * freeH };
}

/** Fractions for a dragged pixel position (clamped into the area). */
export function barFractions(area: Size, bar: Size, left: number, top: number): { x: number; y: number } {
  const freeW = Math.max(0, area.w - bar.w);
  const freeH = Math.max(0, area.h - bar.h);
  return { x: freeW ? clamp01(left / freeW) : 0.5, y: freeH ? clamp01(top / freeH) : 0.5 };
}
