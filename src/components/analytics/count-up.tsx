"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface CountUpConfig {
  /** The target numeric value to animate to. */
  value: number;
  decimals?: number;
  prefix?: string; // sits after the sign, e.g. "$" → "-$1,490"
  suffix?: string; // e.g. "%", "R", " / 8"
  signed?: boolean; // force a leading "+" on non-negative values
  grouping?: boolean; // thousands separators on the integer part
  durationMs?: number;
}

function addThousands(body: string): string {
  const [int, dec] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${grouped}.${dec}` : grouped;
}

function formatNumber(
  n: number,
  { decimals = 0, prefix = "", suffix = "", signed = false, grouping = false }: CountUpConfig,
): string {
  const neg = n < 0;
  let body = Math.abs(n).toFixed(decimals);
  if (grouping) body = addThousands(body);
  const sign = neg ? "-" : signed ? "+" : "";
  return `${sign}${prefix}${body}${suffix}`;
}

/**
 * CountUp — an opt-in client island that animates a KPI number from 0 to its
 * target once, on mount, easing out. It renders the final formatted value on the
 * server and on first client paint (so there is no hydration mismatch), then the
 * mount effect runs the animation. Honors `prefers-reduced-motion` by skipping
 * straight to the value. Format props are serializable so the whole thing can be
 * rendered from a server component.
 */
export function CountUp({ className, ...config }: CountUpConfig & { className?: string }) {
  const { value, durationMs = 650 } = config;
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Reduced motion: `display` already initialises to `value`, so there is
    // nothing to animate and nothing to set — just skip the animation.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(value * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  return <span className={cn("tabular-nums", className)}>{formatNumber(display, config)}</span>;
}
