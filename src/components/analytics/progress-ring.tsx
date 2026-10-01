import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type RingTone = "brand" | "success" | "danger" | "warning" | "muted";

const TONE_COLOR: Record<RingTone, string> = {
  brand: "var(--viz-1)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  muted: "var(--muted-foreground)",
};

/**
 * ProgressRing — a radial gauge for a single 0–100% metric. Pure SVG (server
 * component, no client JS). The arc sweeps clockwise from the top; the center
 * holds the value (or arbitrary `children`). Data-hued by default (brand),
 * because a ring here shows magnitude, not status.
 */
export function ProgressRing({
  value,
  size = 76,
  stroke = 6,
  tone = "brand",
  label,
  centerLabel,
  children,
  className,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  tone?: RingTone;
  label?: string;
  centerLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;
  const color = TONE_COLOR[tone];

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
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
          {value != null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children ?? (
            <span className="text-sm font-semibold tabular-nums">
              {centerLabel ?? (value == null ? "—" : `${Math.round(value)}%`)}
            </span>
          )}
        </div>
      </div>
      {label && (
        <span className="text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
      )}
    </div>
  );
}
