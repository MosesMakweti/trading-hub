import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DeltaChip } from "@/components/analytics/delta-chip";
import { SparkBars, Sparkline } from "@/components/analytics/sparkline";
import { CountUp, type CountUpConfig } from "@/components/analytics/count-up";

/**
 * KpiCard — a metric-with-context tile: headline number plus optional
 * change-vs-previous delta and one mini-chart, so every KPI carries visual
 * context rather than sitting as a bare figure. All context props are optional,
 * so plain label/value usages render as before. Server component (no client JS).
 *
 * Mini-chart forms (pick by the data's shape, never for decoration):
 *  - `spark`      — a running/cumulative series → line (latest point marked);
 *  - `sparkBars`  — independent per-period values (daily %/R) → diverging bars;
 *  - `meter`      — a 0–100 ratio (win rate, adherence) → a track with an
 *                   optional reference tick (e.g. 50%).
 */
export function KpiCard({
  label,
  value,
  count,
  sublabel,
  tone = "neutral",
  delta,
  deltaCaption,
  spark,
  sparkTone = "auto",
  sparkBars,
  meter,
  icon: Icon,
  size = "default",
  className,
}: {
  label: string;
  /** The metric text. Also the SSR / reduced-motion value when `count` animates. */
  value: string;
  /** Opt-in: animate the value from 0 on mount. Serializable so a server component can pass it. */
  count?: CountUpConfig;
  sublabel?: string;
  tone?: "neutral" | "success" | "danger";
  delta?: { value: string; direction: "up" | "down" | "flat" };
  /** What the delta is measured against, e.g. "vs prev. period". */
  deltaCaption?: string;
  spark?: number[];
  sparkTone?: "auto" | "success" | "danger" | "brand" | "muted";
  sparkBars?: number[];
  meter?: { value: number | null; tone?: "brand" | "success" | "danger" | "warning"; reference?: number };
  icon?: LucideIcon;
  /** "lg" bumps the headline value up a size — for the one anchor metric in a
   *  dense grid (e.g. Net P&L), not for routine use. */
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass group relative flex flex-col overflow-hidden rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        {Icon && <Icon className="size-3.5 text-muted-foreground/70" aria-hidden />}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <div
          className={cn(
            "font-semibold tracking-tight",
            size === "lg" ? "text-3xl" : "text-2xl",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
          )}
        >
          {count ? <CountUp {...count} /> : value}
        </div>
        {delta && <DeltaChip value={delta.value} direction={delta.direction} size="xs" />}
      </div>

      {(sublabel || (delta && deltaCaption)) && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {sublabel}
          {sublabel && delta && deltaCaption && " · "}
          {delta && deltaCaption}
        </div>
      )}

      {meter && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="relative h-full">
            <div
              className={cn(
                "h-full rounded-full",
                (meter.tone ?? "brand") === "brand" && "bg-viz-1",
                meter.tone === "success" && "bg-viz-profit",
                meter.tone === "danger" && "bg-viz-loss",
                meter.tone === "warning" && "bg-viz-warning",
              )}
              style={{ width: `${Math.max(0, Math.min(100, meter.value ?? 0))}%` }}
            />
            {meter.reference != null && (
              <div className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `${meter.reference}%` }} />
            )}
          </div>
        </div>
      )}

      {sparkBars && sparkBars.length > 0 && (
        <div className="mt-3 -mb-1">
          <SparkBars values={sparkBars} width={160} height={28} className="w-full" />
        </div>
      )}

      {spark && spark.length >= 2 && (
        <div className="mt-3 -mb-1">
          <Sparkline values={spark} width={160} height={28} tone={sparkTone} endDot className="w-full" />
        </div>
      )}
    </div>
  );
}
