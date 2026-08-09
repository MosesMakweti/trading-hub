import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DonutSegment {
  label: string;
  value: number;
  color: string; // a CSS color / token, e.g. "var(--success)"
}

/**
 * Donut — categorical distribution as a ring of segments. Pure SVG (server
 * component). A small surface-colored gap separates adjacent segments (per the
 * dataviz mark specs); the center holds a headline (`children`). Identity is
 * carried by the optional legend, never color alone.
 */
export function Donut({
  segments,
  size = 132,
  stroke = 14,
  gap = 3,
  children,
  legend = true,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  gap?: number;
  children?: ReactNode;
  legend?: boolean;
  className?: string;
}) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((seg) => {
            const len = (seg.value / total) * circumference;
            const visible = Math.max(len - gap, 0.001);
            const arc = (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={`${visible} ${circumference - visible}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return arc;
          })
      : [];

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={stroke}
          />
          {arcs}
        </svg>
        {children && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {children}
          </div>
        )}
      </div>
      {legend && (
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {segments.map((seg) => (
            <li key={seg.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: seg.color }} aria-hidden />
              <span>{seg.label}</span>
              <span className="tabular-nums text-foreground">{seg.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
