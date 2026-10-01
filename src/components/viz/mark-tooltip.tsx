"use client";

import type { ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { TooltipCard, type TooltipModel } from "@/components/viz/chart-tooltip";

/**
 * MarkTooltip — the shared TooltipCard on a non-Recharts mark (a breakdown
 * row, a heatmap cell, a composition segment). The trigger element is the
 * hit target, so it should be at least ~24px and focusable; the same readout
 * shows on hover and on keyboard focus.
 */
export function MarkTooltip({
  model,
  children,
  side = "top",
}: {
  model: TooltipModel;
  /** A single focusable element (rendered as the trigger). */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="isolate z-50">
          <TooltipPrimitive.Popup className="z-50 origin-(--transform-origin) data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
            <TooltipCard {...model} />
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
