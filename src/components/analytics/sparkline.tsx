import { useId } from "react";

import { cn } from "@/lib/utils";

type SparkTone = "auto" | "success" | "danger" | "brand" | "muted";

function resolveColor(tone: SparkTone, values: number[]): string {
  if (tone === "success") return "var(--success)";
  if (tone === "danger") return "var(--danger)";
  // "brand" = the single magnitude data hue (identity slot 1).
  if (tone === "brand") return "var(--viz-1)";
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
  endDot = false,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: SparkTone;
  fill?: boolean;
  strokeWidth?: number;
  /** Mark the latest value (KPI tiles). */
  endDot?: boolean;
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

  const last = points[points.length - 1];
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)} ${height} L${points[0][0].toFixed(2)} ${height} Z`;
  const color = resolveColor(tone, values);

  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={cn("overflow-visible", endDot ? "w-full" : className)}
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

  if (!endDot) return svg;
  // The SVG may be stretched (preserveAspectRatio="none"), which would squash a
  // circle — so the end dot is an HTML overlay positioned by percentage.
  return (
    <span className={cn("relative block", className)}>
      {svg}
      <span
        aria-hidden
        className="absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-card"
        style={{ left: `${(last[0] / width) * 100}%`, top: `${(last[1] / height) * 100}%`, background: color }}
      />
    </span>
  );
}

/**
 * SparkBars — per-period values (daily returns, daily R) as tiny diverging
 * bars around a zero line: profit up, loss down. The right form for a series
 * of independent values, where a connected line would imply continuity.
 */
export function SparkBars({
  values,
  width = 160,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return <div className={cn("h-7 w-24", className)} aria-hidden />;
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1e-9);
  const n = values.length;
  const slot = width / n;
  const bar = Math.max(1, Math.min(6, slot - 1));
  const mid = height / 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" className={className} aria-hidden>
      <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--viz-axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const h = Math.max(v === 0 ? 0 : 1, (Math.abs(v) / maxAbs) * (mid - 1));
        return (
          <rect
            key={i}
            x={i * slot + (slot - bar) / 2}
            y={v >= 0 ? mid - h : mid}
            width={bar}
            height={h}
            rx={Math.min(1, bar / 2)}
            fill={v > 0 ? "var(--viz-profit)" : v < 0 ? "var(--viz-loss)" : "var(--viz-neutral)"}
          />
        );
      })}
    </svg>
  );
}
