import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DeltaChip } from "@/components/analytics/delta-chip";
import { Sparkline } from "@/components/analytics/sparkline";

/**
 * KpiCard — a metric-with-context tile: headline number plus optional
 * change-vs-previous delta and a mini sparkline, so every KPI carries visual
 * context rather than sitting as a bare figure. All context props are optional,
 * so plain label/value usages render as before. Server component (no client JS).
 */
export function KpiCard({
  label,
  value,
  sublabel,
  tone = "neutral",
  delta,
  spark,
  sparkTone = "auto",
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "success" | "danger";
  delta?: { value: string; direction: "up" | "down" | "flat" };
  spark?: number[];
  sparkTone?: "auto" | "success" | "danger" | "brand" | "muted";
  icon?: LucideIcon;
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
            "text-2xl font-semibold tracking-tight tabular-nums",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
          )}
        >
          {value}
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
