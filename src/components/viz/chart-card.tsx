import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DeltaChip } from "@/components/analytics/delta-chip";
import type { Polarity } from "@/components/viz/tokens";

/**
 * ChartCard — the one analytical card every chart sits in.
 *
 * Hierarchy, top to bottom: title (what it is) · hint (scope/caveat, recedes)
 * · headline value + delta (the answer) · actions (unit/mode tabs, right) ·
 * legend · plot · footer stat strip. Empty and loading states reserve the
 * plot's height so a card never collapses or jumps. Server component — the
 * plot inside may be a client chart.
 */
export function ChartCard({
  title,
  hint,
  icon: Icon,
  headline,
  delta,
  actions,
  legend,
  footer,
  empty,
  loading = false,
  pending = false,
  plotHeight = 240,
  variant = "default",
  className,
  children,
}: {
  title: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** The answer the chart supports — e.g. "+12.40R" over the range. */
  headline?: { value: string; tone?: Polarity; caption?: ReactNode };
  delta?: { value: string; direction: "up" | "down" | "flat"; caption?: string };
  actions?: ReactNode;
  legend?: ReactNode;
  footer?: ReactNode;
  /** When set, the plot area shows this empty state instead of `children`. */
  empty?: { title: string; hint?: string } | null;
  /** First load: a quiet placeholder at plot height. */
  loading?: boolean;
  /** Refetch: hold the previous frame at reduced opacity (no skeleton flash). */
  pending?: boolean;
  /** Reserved height for empty/loading states (match the chart's height). */
  plotHeight?: number;
  /** "primary" for the page's lead instrument (equity curve) — more air, larger headline. */
  variant?: "primary" | "default";
  className?: string;
  children?: ReactNode;
}) {
  const primary = variant === "primary";
  return (
    <section
      className={cn("glass flex flex-col rounded-2xl", primary ? "gap-4 p-5" : "gap-3 p-4", className)}
      aria-label={title}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
            {title}
          </h3>
          {headline && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={cn(
                  "font-semibold tracking-tight",
                  primary ? "text-3xl" : "text-xl",
                  headline.tone === "profit" && "text-success",
                  headline.tone === "loss" && "text-danger",
                )}
              >
                {headline.value}
              </span>
              {delta && (
                <span className="flex items-center gap-1.5">
                  <DeltaChip value={delta.value} direction={delta.direction} size="xs" />
                  {delta.caption && <span className="text-xs text-muted-foreground">{delta.caption}</span>}
                </span>
              )}
              {headline.caption && <span className="text-xs text-muted-foreground">{headline.caption}</span>}
            </div>
          )}
          {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>

      {legend && !empty && !loading && <div>{legend}</div>}

      {loading ? (
        <PlotPlaceholder height={plotHeight} />
      ) : empty ? (
        <EmptyPlot height={plotHeight} title={empty.title} hint={empty.hint} />
      ) : (
        <div className={cn("min-w-0 transition-opacity duration-200", pending && "opacity-50")} aria-busy={pending || undefined}>
          {children}
        </div>
      )}

      {footer && !empty && !loading && <div className="border-t border-border pt-3">{footer}</div>}
    </section>
  );
}

/** Empty plot: reserves the chart's height and draws a faint baseline so the
 *  card still reads as "a chart, waiting for data" — never a blank hole. */
export function EmptyPlot({ height, title, hint }: { height: number; title: string; hint?: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-1 text-center" style={{ minHeight: height }}>
      <div aria-hidden className="absolute inset-x-0 bottom-6 h-px bg-viz-axis" />
      <div aria-hidden className="absolute inset-x-0 top-1/3 h-px bg-viz-grid" />
      <p className="relative text-sm font-medium text-muted-foreground">{title}</p>
      {hint && <p className="relative max-w-xs text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function PlotPlaceholder({ height }: { height: number }) {
  return (
    <div className="flex items-end gap-1.5" style={{ height }} aria-busy aria-label="Loading chart">
      {Array.from({ length: 24 }, (_, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-sm bg-muted"
          style={{ height: `${30 + Math.round(45 * Math.abs(Math.sin(i * 0.7)))}%` }}
        />
      ))}
    </div>
  );
}

/** A label/value cell for a ChartCard footer strip. */
export function ChartStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: Polarity | "warning";
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "profit" && "text-success",
          tone === "loss" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
      {hint && <div className="truncate text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/** Responsive grid of ChartStats for a footer. */
export function ChartStatRow({ children, cols = 4, className }: { children: ReactNode; cols?: 3 | 4; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-3", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4", className)}>
      {children}
    </div>
  );
}
