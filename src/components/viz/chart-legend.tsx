"use client";

import { cn } from "@/lib/utils";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Mirrors the mark: line for lines, dash for references, swatch for bars/areas. */
  mark?: "line" | "dash" | "swatch";
  /** Optional trailing value (e.g. the series' end value). */
  value?: string;
}

/**
 * ChartLegend — identity for ≥ 2 series. With `onToggle`, items become
 * toggle buttons (aria-pressed) for interactive filtering; a hidden series
 * keeps its colour (colour follows the entity) and simply dims here.
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  className,
}: {
  items: LegendItem[];
  hidden?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false;
        const body = (
          <>
            <LegendMark color={item.color} mark={item.mark} />
            <span className={cn("text-xs", off ? "text-muted-foreground/50 line-through" : "text-muted-foreground")}>
              {item.label}
            </span>
            {item.value && !off && <span className="text-xs font-medium tabular-nums text-foreground">{item.value}</span>}
          </>
        );
        return (
          <li key={item.key} className={cn(off && "opacity-60")}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                onClick={() => onToggle(item.key)}
                className="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LegendMark({ color, mark = "line" }: { color: string; mark?: LegendItem["mark"] }) {
  if (mark === "swatch") return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
  return (
    <svg aria-hidden width="14" height="6" className="shrink-0">
      <line
        x1="1"
        y1="3"
        x2="13"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={mark === "dash" ? "3 2" : undefined}
      />
    </svg>
  );
}
