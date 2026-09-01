import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DeltaChip } from "@/components/analytics/delta-chip";
import { Sparkline } from "@/components/analytics/sparkline";
import { CountUp, type CountUpConfig } from "@/components/analytics/count-up";

/**
 * KpiCard — a metric-with-context tile: headline number plus optional
 * change-vs-previous delta and a mini sparkline, so every KPI carries visual
 * context rather than sitting as a bare figure. All context props are optional,
 * so plain label/value usages render as before. Server component (no client JS).
 */
export function KpiCard({
  label,
  value,
  count,
  sublabel,
  tone = "neutral",
  delta,
  spark,
  sparkTone = "auto",
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
  spark?: number[];
  sparkTone?: "auto" | "success" | "danger" | "brand" | "muted";
  icon?: LucideIcon;
  /** "lg" bumps the headline value up a size — for the one anchor metric in a
   *  dense grid (e.g. Net P&L), not for routine use. */
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass group relative flex flex-col overflow-hidden rounded-xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated",
        className,
      )}
    >
      {/* subtle brand sheen that lifts on hover */}
      <div className="bg-brand-gradient pointer-events-none absolute -top-8 -right-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20" />

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
        {Icon && <Icon className="size-3.5 text-muted-foreground/70" aria-hidden />}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <div
          className={cn(
            "font-semibold tracking-tight tabular-nums",
            size === "lg" ? "text-3xl" : "text-2xl",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
          )}
        >
          {count ? <CountUp {...count} /> : value}
        </div>
        {delta && <DeltaChip value={delta.value} direction={delta.direction} size="xs" />}
      </div>

      {sublabel && <div className="mt-0.5 text-xs text-muted-foreground">{sublabel}</div>}

      {spark && spark.length >= 2 && (
        <div className="mt-3 -mb-1">
          <Sparkline values={spark} width={160} height={28} tone={sparkTone} className="w-full" />
        </div>
      )}
    </div>
  );
}
