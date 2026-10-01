"use client";

import { cn } from "@/lib/utils";
import { MarkTooltip } from "@/components/viz/mark-tooltip";

export interface CompositionPart {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Extra tooltip rows / caption (e.g. average R of the part). */
  detail?: string;
}

/**
 * CompositionBar — part-to-whole (≤ 6 parts) as one stacked bar, segments
 * separated by a 2px surface gap (never a stroke). A segment carries its
 * count/share inline only when it's wide enough; otherwise the legend row
 * underneath (always present) and the tooltip carry it. Every segment is a
 * focusable hover target.
 */
export function CompositionBar({
  parts,
  height = 14,
  unitLabel = "trades",
  className,
}: {
  parts: CompositionPart[];
  height?: number;
  unitLabel?: string;
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex w-full gap-[2px] overflow-hidden rounded-[5px]" style={{ height }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {total === 0 ? (
          <div className="h-full w-full rounded-[5px] bg-muted" />
        ) : (
          visible.map((p) => {
            const share = (p.value / total) * 100;
            return (
              <MarkTooltip
                key={p.key}
                model={{
                  title: p.label,
                  subtitle: p.detail,
                  rows: [
                    { key: "n", label: unitLabel[0].toUpperCase() + unitLabel.slice(1), value: String(p.value), color: p.color, mark: "swatch" },
                    { key: "s", label: "Share", value: `${share.toFixed(1)}%`, mark: "none" },
                  ],
                }}
              >
                <button
                  type="button"
                  aria-label={`${p.label}: ${p.value} ${unitLabel}, ${share.toFixed(0)}%`}
                  className="h-full min-w-[3px] outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ width: `${share}%`, background: p.color }}
                />
              </MarkTooltip>
            );
          })
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            {p.label}
            <span className="font-medium tabular-nums text-foreground">{p.value}</span>
            {total > 0 && <span className="tabular-nums">{((p.value / total) * 100).toFixed(0)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
