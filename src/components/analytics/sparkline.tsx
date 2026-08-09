import { useId } from "react";

import { cn } from "@/lib/utils";

type SparkTone = "auto" | "success" | "danger" | "brand" | "muted";

function resolveColor(tone: SparkTone, values: number[]): string {
  if (tone === "success") return "var(--success)";
  if (tone === "danger") return "var(--danger)";
  if (tone === "brand") return "var(--chart-1)";
  if (tone === "muted") return "var(--muted-foreground)";
  // auto: green when the series ends at or above where it started, red otherwise
  const up = values.length < 2 || values[values.length - 1] >= values[0];
  return up ? "var(--success)" : "var(--danger)";
}

/**
 * Sparkline — a tiny, dependency-free trend line for KPI cards and table rows.
 * Pure inline SVG so it renders on the server with zero client JS. Auto-scales
 * the series into the viewBox; optional soft area fill anchors it to the baseline.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = "auto",
  fill = true,
  strokeWidth = 1.5,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: SparkTone;
  fill?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  const gradientId = useId();

  if (values.length < 2) {
    return <div className={cn("h-7 w-24", className)} aria-hidden />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = strokeWidth; // keep the stroke from clipping at the edges
  const innerH = height - pad * 2;
  const innerW = width - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)} ${height} L${points[0][0].toFixed(2)} ${height} Z`;
  const color = resolveColor(tone, values);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
